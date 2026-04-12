import { Router, type IRouter } from "express";
import multer from "multer";
import { readFile } from "fs/promises";
import path from "path";
import { eq, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { papersTable, questionsTable, batchItemsTable } from "@workspace/db/schema";
import { parsePdfText, type ParseResult } from "../lib/pdf-parser";
import { logger } from "../lib/logger";
import { B2StorageService } from "../lib/b2Storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

const router: IRouter = Router();
const storage = new B2StorageService();

async function uploadQuestionFiguresToB2(
  paperId: number,
  questions: ParseResult["questions"]
): Promise<Map<number, string>> {
  const objectPaths = new Map<number, string>();
  for (const q of questions) {
    if (!q.figureBuffer) continue;
    try {
      const key = `question-snapshots/${paperId}/${q.questionNumber}.jpg`;
      const objectPath = await storage.uploadBuffer(key, q.figureBuffer, "image/jpeg");
      objectPaths.set(q.questionNumber, objectPath);
    } catch (err) {
      logger.warn({ err, questionNumber: q.questionNumber, paperId }, "Failed to upload question snapshot to B2");
    }
  }
  return objectPaths;
}

function resolveWorkspacePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), "../..", filePath);
}

async function setStage(paperId: number, stage: string) {
  await db.update(papersTable).set({ processingStage: stage }).where(eq(papersTable.id, paperId));
}

async function processPdfAndSave(paperId: number, pdfBuffer: Buffer, fileName: string): Promise<void> {
  try {
    await setStage(paperId, "extracting_text");
    const result = await parsePdfText(pdfBuffer, (stage) => setStage(paperId, stage));

    await setStage(paperId, "uploading_figures");
    const figureObjectPaths = await uploadQuestionFiguresToB2(paperId, result.questions);

    if (result.questions.length > 0) {
      await db.insert(questionsTable).values(
        result.questions.map((q) => ({
          paperId,
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

    await db.update(papersTable)
      .set({
        totalQuestions: result.questions.length,
        fullPdfText: result.fullPdfText,
        processingStatus: "done",
        processingStage: null,
      })
      .where(eq(papersTable.id, paperId));

    logger.info({ paperId, totalQuestions: result.questions.length, figuresUploaded: figureObjectPaths.size }, "Paper processed successfully");
  } catch (err) {
    logger.error({ err, paperId }, "PDF processing failed");
    await db.update(papersTable)
      .set({ processingStatus: "error", processingError: String(err) })
      .where(eq(papersTable.id, paperId));
  }
}

router.post("/papers/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { examName, year, shift } = req.body;
  if (!examName) {
    res.status(400).json({ error: "examName is required" });
    return;
  }

  req.log.info({ fileName: req.file.originalname }, "Processing PDF upload");

  const [paper] = await db.insert(papersTable).values({
    examName,
    year: year || null,
    shift: shift || null,
    totalQuestions: 0,
    fileName: req.file.originalname,
    processingStatus: "processing",
  }).returning();

  const fileBuffer = req.file.buffer;
  setImmediate(() => {
    processPdfAndSave(paper.id, fileBuffer, req.file!.originalname);
  });

  res.json({
    success: true,
    paperId: paper.id,
    processing: true,
    totalQuestions: 0,
    message: `PDF uploaded successfully. Extracting questions in background...`,
  });
});

router.post("/papers/:id/process-attached", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paperId = parseInt(raw, 10);

  if (isNaN(paperId)) {
    res.status(400).json({ error: "Invalid paper ID" });
    return;
  }

  const { filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ error: "filePath is required" });
    return;
  }

  req.log.info({ filePath }, "Processing attached PDF");

  const buffer = await readFile(resolveWorkspacePath(filePath));
  const attachedFileName = filePath.split("/").pop() || "attached.pdf";

  let paper = (await db.select().from(papersTable).where(eq(papersTable.fileName, attachedFileName)))[0];

  if (!paper) {
    const [newPaper] = await db.insert(papersTable).values({
      examName: "Processing...",
      totalQuestions: 0,
      fileName: attachedFileName,
      processingStatus: "processing",
    }).returning();
    paper = newPaper;
  } else {
    await db.update(papersTable)
      .set({ processingStatus: "processing", totalQuestions: 0 })
      .where(eq(papersTable.id, paper.id));
    await db.delete(questionsTable).where(eq(questionsTable.paperId, paper.id));
  }

  const paperId2 = paper.id;
  setImmediate(() => {
    processPdfAndSave(paperId2, buffer, attachedFileName);
  });

  res.json({
    success: true,
    paperId: paper.id,
    processing: true,
    totalQuestions: 0,
    message: `PDF queued for processing. Questions will be extracted shortly.`,
  });
});

router.get("/papers", async (_req, res): Promise<void> => {
  const papers = await db.select().from(papersTable).orderBy(papersTable.createdAt);
  res.json(papers);
});

router.get("/papers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, id));

  if (!paper) {
    res.status(404).json({ error: "Paper not found" });
    return;
  }

  res.json(paper);
});

router.get("/papers/:id/questions", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const questions = await db.select()
    .from(questionsTable)
    .where(eq(questionsTable.paperId, id))
    .orderBy(questionsTable.questionNumber);

  res.json(questions);
});

router.get("/questions", async (req, res): Promise<void> => {
  const { subject, hasFigure, paperId } = req.query;

  let query = db.select().from(questionsTable);

  if (subject && typeof subject === "string") {
    query = query.where(eq(questionsTable.subject, subject)) as typeof query;
  }

  if (hasFigure === "true") {
    query = query.where(eq(questionsTable.hasFigure, true)) as typeof query;
  }

  if (paperId) {
    const pid = parseInt(paperId as string, 10);
    if (!isNaN(pid)) {
      query = query.where(eq(questionsTable.paperId, pid)) as typeof query;
    }
  }

  const questions = await query.orderBy(questionsTable.questionNumber);
  res.json(questions);
});

router.patch("/papers/:id/update", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid paper ID" }); return; }

  const { examName, year, shift } = req.body;
  const updates: Record<string, unknown> = {};
  if (examName !== undefined) updates.examName = examName;
  if (year !== undefined) updates.year = year || null;
  if (shift !== undefined) updates.shift = shift || null;

  const [updated] = await db.update(papersTable).set(updates).where(eq(papersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Paper not found" }); return; }
  res.json(updated);
});

router.delete("/papers/:id/delete", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid paper ID" }); return; }

  await db.delete(questionsTable).where(eq(questionsTable.paperId, id));
  await db.delete(batchItemsTable).where(eq(batchItemsTable.paperId, id));
  const [deleted] = await db.delete(papersTable).where(eq(papersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Paper not found" }); return; }
  res.json({ success: true });
});

router.patch("/questions/:id/update", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid question ID" }); return; }

  const { questionText, optionA, optionB, optionC, optionD, correctAnswer, figureData, subject, note } = req.body;
  const updates: Record<string, unknown> = {};
  if (questionText !== undefined) updates.questionText = questionText;
  if (optionA !== undefined) updates.optionA = optionA || null;
  if (optionB !== undefined) updates.optionB = optionB || null;
  if (optionC !== undefined) updates.optionC = optionC || null;
  if (optionD !== undefined) updates.optionD = optionD || null;
  if (correctAnswer !== undefined) updates.correctAnswer = correctAnswer || null;
  if (figureData !== undefined) updates.figureData = figureData || null;
  if (subject !== undefined) updates.subject = subject || null;
  if (note !== undefined) updates.note = note || null;

  const [updated] = await db.update(questionsTable).set(updates).where(eq(questionsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Question not found" }); return; }
  res.json(updated);
});

router.get("/figure", async (req, res): Promise<void> => {
  const objectPath = req.query.path;
  if (!objectPath || typeof objectPath !== "string") {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }
  try {
    const signedUrl = await storage.getSignedDownloadUrl(objectPath, 3600);
    res.redirect(302, signedUrl);
  } catch (err) {
    logger.warn({ err, objectPath }, "Failed to generate signed download URL");
    res.status(404).json({ error: "Figure not found or storage not configured" });
  }
});

router.get("/questions/stats", async (_req, res): Promise<void> => {
  const [paperCount] = await db.select({ count: count() }).from(papersTable);
  const [questionCount] = await db.select({ count: count() }).from(questionsTable);
  const [figureCount] = await db.select({ count: count() }).from(questionsTable).where(eq(questionsTable.hasFigure, true));

  const bySubject = await db
    .select({
      subject: questionsTable.subject,
      count: count(),
    })
    .from(questionsTable)
    .groupBy(questionsTable.subject);

  res.json({
    totalPapers: paperCount.count,
    totalQuestions: questionCount.count,
    withFigures: figureCount.count,
    bySubject,
  });
});

router.get("/questions/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [question] = await db.select().from(questionsTable).where(eq(questionsTable.id, id));

  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  res.json(question);
});

export default router;
