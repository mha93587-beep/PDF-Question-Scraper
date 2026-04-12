import { Router } from "express";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { db } from "@workspace/db";
import { batchJobsTable, batchItemsTable, papersTable, questionsTable } from "@workspace/db";
import { parsePdfText } from "../lib/pdf-parser.js";
import { B2StorageService } from "../lib/b2Storage.js";

const router = Router();
const storage = new B2StorageService();

function guessExamNameFromFile(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").trim();
}

async function processBatchInBackground(jobId: number) {
  let zipObjectPath: string | null = null;
  try {
    const [job] = await db.select().from(batchJobsTable).where(eq(batchJobsTable.id, jobId));
    if (!job) return;
    zipObjectPath = job.zipObjectPath;

    await db.update(batchJobsTable).set({ status: "downloading" }).where(eq(batchJobsTable.id, jobId));

    const zipContents = await storage.downloadObject(job.zipObjectPath);
    const zip = await JSZip.loadAsync(zipContents);

    const pdfFiles = Object.entries(zip.files).filter(
      ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".pdf") && !name.startsWith("__MACOSX")
    );

    if (pdfFiles.length === 0) {
      await db.update(batchJobsTable)
        .set({ status: "error", error: "No PDF files found in the ZIP archive." })
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
      const placeholderName = guessExamNameFromFile(shortName);

      try {
        await db.update(batchItemsTable)
          .set({ status: "processing", processingStage: "extracting" })
          .where(eq(batchItemsTable.id, item.id));

        const pdfBuffer = Buffer.from(await zipEntry.async("arraybuffer"));

        const [paper] = await db.insert(papersTable).values({
          examName: placeholderName,
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
              figureData: q.figureData,
              note: q.note,
            }))
          );
        }

        await db.update(papersTable).set({
          examName: placeholderName,
          totalQuestions: result.questions.length,
          processingStatus: "done",
          processingStage: null,
        }).where(eq(papersTable.id, paper.id));

        await db.update(batchItemsTable).set({
          status: "done",
          processingStage: null,
          questionsExtracted: result.questions.length,
          paperId: paper.id,
        }).where(eq(batchItemsTable.id, item.id));

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
      try {
        await storage.deleteObject(zipObjectPath);
      } catch (deleteErr) {
        console.error("Failed to delete processed ZIP from Backblaze B2", deleteErr);
      }
    }
  }
}

router.post("/batch/start", async (req, res) => {
  const { zipObjectPath, zipFileName } = req.body;
  if (!zipObjectPath) {
    res.status(400).json({ error: "zipObjectPath is required" });
    return;
  }

  const [job] = await db.insert(batchJobsTable).values({
    zipObjectPath,
    zipFileName: zipFileName || null,
    status: "pending",
  }).returning();

  processBatchInBackground(job.id).catch(console.error);

  res.json({ jobId: job.id });
});

router.get("/batch/:jobId", async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db.select().from(batchJobsTable).where(eq(batchJobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const items = await db.select().from(batchItemsTable).where(eq(batchItemsTable.batchJobId, jobId));

  res.json({
    id: job.id,
    status: job.status,
    zipFileName: job.zipFileName,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    failedFiles: job.failedFiles,
    error: job.error,
    createdAt: job.createdAt?.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      status: item.status,
      processingStage: item.processingStage,
      questionsExtracted: item.questionsExtracted,
      error: item.error,
      paperId: item.paperId,
    })),
  });
});

export default router;
