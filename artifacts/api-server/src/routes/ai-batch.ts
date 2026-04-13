import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { batchJobsTable, batchItemsTable, papersTable, questionsTable } from "@workspace/db/schema";
import { parsePdfText } from "../lib/pdf-parser.js";
import { B2StorageService } from "../lib/b2Storage.js";
import { logger } from "../lib/logger.js";
import { runAiExtraction } from "./ai-extract.js";

const storage = new B2StorageService();

export async function processBatchInBackground(jobId: number): Promise<void> {
  let zipObjectPath: string | null = null;
  try {
    const [job] = await db.select().from(batchJobsTable).where(eq(batchJobsTable.id, jobId));
    if (!job) return;
    zipObjectPath = job.zipObjectPath;
    const withAi = job.aiExtract === "true";

    await db.update(batchJobsTable).set({ status: "downloading" }).where(eq(batchJobsTable.id, jobId));

    const zipContents = await storage.downloadObject(job.zipObjectPath);
    const zip = await JSZip.loadAsync(zipContents);

    const pdfFiles = Object.entries(zip.files).filter(
      ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".pdf") && !name.startsWith("__MACOSX")
    );

    if (pdfFiles.length === 0) {
      await db.update(batchJobsTable)
        .set({ status: "error", error: "No PDF files found in ZIP." })
        .where(eq(batchJobsTable.id, jobId));
      return;
    }

    const items = await db.insert(batchItemsTable).values(
      pdfFiles.map(([name]) => ({
        batchJobId: jobId,
        fileName: name.split("/").pop() || name,
        status: "pending" as const,
      }))
    ).returning();

    await db.update(batchJobsTable)
      .set({ totalFiles: pdfFiles.length, status: "processing" })
      .where(eq(batchJobsTable.id, jobId));

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < pdfFiles.length; i++) {
      const [filePath, zipEntry] = pdfFiles[i];
      const item = items[i];
      const shortName = filePath.split("/").pop() || filePath;
      const examName = shortName.replace(/\.pdf$/i, "").trim();

      try {
        await db.update(batchItemsTable)
          .set({ status: "processing", processingStage: "extracting" })
          .where(eq(batchItemsTable.id, item.id));

        const pdfBuffer = Buffer.from(await zipEntry.async("arraybuffer"));

        const [paper] = await db.insert(papersTable).values({
          examName,
          processingStatus: "processing",
          processingStage: "extracting",
          fileName: shortName,
        }).returning();

        const setStage = async (stage: string) => {
          await db.update(batchItemsTable)
            .set({ processingStage: stage })
            .where(eq(batchItemsTable.id, item.id));
          await db.update(papersTable)
            .set({ processingStage: stage })
            .where(eq(papersTable.id, paper.id));
        };

        const result = await parsePdfText(pdfBuffer, setStage);

        await db.update(batchItemsTable)
          .set({ processingStage: "uploading_figures" })
          .where(eq(batchItemsTable.id, item.id));

        const figureObjectPaths = new Map<number, string>();
        for (const q of result.questions) {
          if (!q.figureBuffer) continue;
          try {
            const key = `question-snapshots/${paper.id}/${q.questionNumber}.jpg`;
            const objectPath = await storage.uploadBuffer(key, q.figureBuffer, "image/jpeg");
            figureObjectPaths.set(q.questionNumber, objectPath);
          } catch {}
        }

        if (result.questions.length > 0) {
          await db.insert(questionsTable).values(
            result.questions.map((q) => ({
              paperId: paper.id,
              questionNumber: q.questionNumber,
              questionIdOriginal: q.questionIdOriginal,
              questionText: q.questionText,
              optionA: q.optionA,
              optionB: q.optionB,
              optionC: q.optionC,
              optionD: q.optionD,
              correctAnswer: q.correctAnswer,
              chosenOption: q.chosenOption,
              status: q.status,
              hasFigure: q.hasFigure,
              figureData: null,
              figureObjectPath: figureObjectPaths.get(q.questionNumber) ?? null,
              note: q.note,
            }))
          );
        }

        await db.update(papersTable).set({
          examName,
          totalQuestions: result.questions.length,
          fullPdfText: result.fullPdfText,
          processingStatus: "done",
          processingStage: null,
        }).where(eq(papersTable.id, paper.id));

        await db.update(batchItemsTable).set({
          processingStage: null,
          questionsExtracted: result.questions.length,
          paperId: paper.id,
        }).where(eq(batchItemsTable.id, item.id));

        if (withAi && result.fullPdfText && result.fullPdfText.trim().length > 100) {
          await db.update(batchItemsTable)
            .set({ processingStage: "ai_extracting", aiExtractionStatus: "processing" })
            .where(eq(batchItemsTable.id, item.id));
          try {
            await runAiExtraction(paper.id);
            const [updated] = await db.select().from(papersTable).where(eq(papersTable.id, paper.id));
            await db.update(batchItemsTable).set({
              aiExtractionStatus: "done",
              questionsExtracted: updated?.totalQuestions ?? result.questions.length,
              processingStage: null,
            }).where(eq(batchItemsTable.id, item.id));
          } catch (aiErr: any) {
            await db.update(batchItemsTable).set({
              aiExtractionStatus: "error",
              processingStage: null,
            }).where(eq(batchItemsTable.id, item.id));
            logger.warn({ aiErr, paperId: paper.id }, "AI extraction failed for batch item");
          }
        }

        await db.update(batchItemsTable).set({ status: "done" }).where(eq(batchItemsTable.id, item.id));
        processed++;
      } catch (err: any) {
        failed++;
        await db.update(batchItemsTable).set({
          status: "error",
          processingStage: null,
          error: err?.message ?? "Unknown error",
        }).where(eq(batchItemsTable.id, item.id));
      }

      await db.update(batchJobsTable).set({
        processedFiles: processed,
        failedFiles: failed,
        updatedAt: new Date(),
      }).where(eq(batchJobsTable.id, jobId));
    }

    await db.update(batchJobsTable).set({
      status: failed === pdfFiles.length ? "error" : "done",
      updatedAt: new Date(),
    }).where(eq(batchJobsTable.id, jobId));

  } catch (err: any) {
    await db.update(batchJobsTable).set({
      status: "error",
      error: err?.message ?? "Unknown error",
    }).where(eq(batchJobsTable.id, jobId));
  } finally {
    if (zipObjectPath) {
      try { await storage.deleteObject(zipObjectPath); } catch {}
    }
  }
}
