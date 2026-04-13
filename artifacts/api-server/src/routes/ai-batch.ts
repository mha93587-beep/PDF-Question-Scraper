import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { batchJobsTable, batchItemsTable, papersTable } from "@workspace/db/schema";
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
          .set({ status: "processing", processingStage: "storing_pdf" })
          .where(eq(batchItemsTable.id, item.id));

        const pdfBuffer = Buffer.from(await zipEntry.async("arraybuffer"));

        const [paper] = await db.insert(papersTable).values({
          examName,
          processingStatus: "processing",
          processingStage: "storing_pdf",
          fileName: shortName,
        }).returning();

        // Store PDF to B2 for Gemini Vision extraction (skip old OCR pipeline)
        const pdfKey = `papers/${paper.id}/original.pdf`;
        const pdfObjectPath = await storage.uploadBuffer(pdfKey, pdfBuffer, "application/pdf");
        logger.info({ paperId: paper.id, pdfObjectPath }, "PDF stored to B2 for Gemini Vision (batch)");

        await db.update(papersTable).set({
          examName,
          processingStatus: "done",
          processingStage: null,
          pdfObjectPath,
          fullPdfText: "",
        }).where(eq(papersTable.id, paper.id));

        await db.update(batchItemsTable).set({
          processingStage: null,
          questionsExtracted: 0,
          paperId: paper.id,
        }).where(eq(batchItemsTable.id, item.id));

        if (withAi) {
          await db.update(batchItemsTable)
            .set({ processingStage: "ai_extracting", aiExtractionStatus: "processing" })
            .where(eq(batchItemsTable.id, item.id));
          try {
            await runAiExtraction(paper.id);
            const [updated] = await db.select().from(papersTable).where(eq(papersTable.id, paper.id));
            await db.update(batchItemsTable).set({
              aiExtractionStatus: "done",
              questionsExtracted: updated?.totalQuestions ?? 0,
              processingStage: null,
            }).where(eq(batchItemsTable.id, item.id));
          } catch (aiErr: any) {
            await db.update(batchItemsTable).set({
              aiExtractionStatus: "error",
              processingStage: null,
            }).where(eq(batchItemsTable.id, item.id));
            logger.warn({ aiErr, paperId: paper.id }, "AI Vision extraction failed for batch item");
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
