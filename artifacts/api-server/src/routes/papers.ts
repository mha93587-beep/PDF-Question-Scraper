import { Router, type IRouter } from "express";
import multer from "multer";
import { readFile } from "fs/promises";
import path from "path";
import { eq, sql, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { papersTable, questionsTable } from "@workspace/db/schema";
import { parsePdfText } from "../lib/pdf-parser";

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

function resolveWorkspacePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), "../..", filePath);
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

  const result = await parsePdfText(req.file.buffer);

  const [paper] = await db.insert(papersTable).values({
    examName: examName || result.examName,
    year: year || null,
    shift: shift || null,
    totalQuestions: result.questions.length,
    fileName: req.file.originalname,
  }).returning();

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

  req.log.info({ paperId: paper.id, totalQuestions: result.questions.length }, "Paper processed");

  res.json({
    success: true,
    paperId: paper.id,
    totalQuestions: result.questions.length,
    message: `Successfully extracted ${result.questions.length} questions from ${req.file.originalname}`,
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
  const result = await parsePdfText(buffer);

  const attachedFileName = filePath.split("/").pop() || "attached.pdf";
  const [paper] = paperId > 0
    ? await db.select().from(papersTable).where(eq(papersTable.id, paperId))
    : await db.select().from(papersTable).where(eq(papersTable.fileName, attachedFileName));

  if (!paper) {
    const examName = result.examName || "Unknown Exam";
    const [newPaper] = await db.insert(papersTable).values({
      examName,
      totalQuestions: result.questions.length,
      fileName: attachedFileName,
    }).returning();

    if (result.questions.length > 0) {
      await db.insert(questionsTable).values(
        result.questions.map((q) => ({
          paperId: newPaper.id,
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

    res.json({
      success: true,
      paperId: newPaper.id,
      totalQuestions: result.questions.length,
      message: `Extracted ${result.questions.length} questions`,
    });
    return;
  }

  await db.delete(questionsTable).where(eq(questionsTable.paperId, paper.id));

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

  await db.update(papersTable).set({ totalQuestions: result.questions.length }).where(eq(papersTable.id, paper.id));

  res.json({
    success: true,
    paperId: paper.id,
    totalQuestions: result.questions.length,
    message: `Extracted ${result.questions.length} questions`,
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
