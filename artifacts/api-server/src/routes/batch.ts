import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import JSZip from "jszip";
import { db } from "@workspace/db";
import { batchJobsTable, batchItemsTable, papersTable, questionsTable } from "@workspace/db";
import { parsePdfText } from "../lib/pdf-parser.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const storage = new ObjectStorageService();

async function processBatchInBackground(jobId: number) {
  try {
    const [job] = await db.select().from(batchJobsTable).where(eq(batchJobsTable.id, jobId));
    if (!job) return;

    await db.update(batchJobsTable).set({ status: "downloading" }).where(eq(batchJobsTable.id, jobId));

    const objectFile = await storage.getObjectEntityFile(job.zipObjectPath);
    const [fileMetadata] = await objectFile.getMetadata();
    const sizeBytes = parseInt(String(fileMetadata.size ?? 0));

    const [zipContents] = await objectFile.download();
    const zip = await JSZip.loadAsync(zipContents);

    const pdfFiles = Object.entries(zip.files).filter(
      ([name, entry]) => !entry.dir && name.toLowerCase().endsWith(".pdf") && !name.startsWith("__MACOSX")
    );

    if (pdfFiles.length === 0) {
      await db.update(batchJobsTable).set({ status: "error", error: "No PDF files found in the ZIP archive." }).where(eq(batchJobsTable.id, jobId));
      return;
    }

    const items = await db.insert(batchItemsTable).values(
      pdfFiles.map(([name]) => ({
        batchJobId: jobId,
        fileName: name.split("/").pop() || name,
        status: "pending" as const,
      }))
    ).returning();

    await db.update(batchJobsTable).set({ totalFiles: pdfFiles.length, status: "processing" }).where(eq(batchJobsTable.id, jobId));

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < pdfFiles.length; i++) {
      const [fileName, zipEntry] = pdfFiles[i];
      const item = items[i];
      const shortName = fileName.split("/").pop() || fileName;

      const guessedExamName = shortName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();

      try {
        await db.update(batchItemsTable).set({ status: "processing", processingStage: "extracting" }).where(eq(batchItemsTable.id, item.id));

        const pdfBuffer = Buffer.from(await zipEntry.async("arraybuffer"));

        const [paper] = await db.insert(papersTable).values({
          examName: guessedExamName,
          processingStatus: "processing",
          processingStage: "extracting",
          fileName: shortName,
        }).returning();

        const setStage = async (stage: string) => {
          await db.update(batchItemsTable).set({ processingStage: stage }).where(eq(batchItemsTable.id, item.id));
          await db.update(papersTable).set({ processingStage: stage }).where(eq(papersTable.id, paper.id));
        };

        const result = await parsePdfText(pdfBuffer, setStage);

        if (result.questions.length > 0) {
          await db.insert(questionsTable).values(
            result.questions.map((q) => ({
              paperId: paper.id,
              questionNumber: q.questionNumber,
              questionIdOriginal: q.questionId,
              questionText: q.questionText,
              optionA: q.options[0] ?? null,
              optionB: q.options[1] ?? null,
              optionC: q.options[2] ?? null,
              optionD: q.options[3] ?? null,
              correctAnswer: q.correctAnswer ?? null,
              hasFigure: q.hasFigure ?? false,
            }))
          );
        }

        await db.update(papersTable).set({
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
