import { Router, type IRouter } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { jsonrepair } from "jsonrepair";
import { db } from "@workspace/db";
import { papersTable, questionsTable } from "@workspace/db/schema";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
import { parsePdfText } from "../lib/pdf-parser.js";
import { B2StorageService } from "../lib/b2Storage.js";

const router: IRouter = Router();
const storage = new B2StorageService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

const SYSTEM_PROMPT = `You are an expert at extracting and structuring exam questions from raw text of Indian competitive exam PDFs (UPSC, RRB, SSC, JEE, NEET, etc.).

Your task:
1. Extract ALL questions from the provided raw text.
2. Clean up OCR artifacts, broken lines, garbled characters, and incomplete sentences.
3. For ALL mathematical expressions, formulas, equations, and reasoning steps: use LaTeX notation.
   - Inline math: wrap in $...$ (e.g., $x^2 + y^2 = z^2$)
   - Block/display math: wrap in $$...$$ (e.g., $$\\int_0^\\infty e^{-x} dx = 1$$)
4. For each question, identify the subject (Mathematics, Physics, Chemistry, Biology, History, Geography, General Science, Reasoning, English, Hindi, etc.)
5. The "note" field should contain a detailed step-by-step explanation/solution of the question.
6. The "correctAnswer" must be one of: "A", "B", "C", or "D".
7. Set "needsProReview" to true ONLY if the question contains complex multi-step derivations or tricky formula-heavy math.

Return ONLY a valid JSON object in this exact format (no markdown, no code blocks, no extra text):
{
  "fullCleanText": "complete clean version of all the text",
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "full question text with $LaTeX$ for math",
      "optionA": "option text",
      "optionB": "option text",
      "optionC": "option text",
      "optionD": "option text",
      "correctAnswer": "A",
      "subject": "Mathematics",
      "note": "Detailed explanation/solution here",
      "needsProReview": false
    }
  ]
}`;

const PRO_REFINE_PROMPT = `You are an expert exam question formatter. Refine the following question:
1. Ensure ALL mathematical expressions use proper LaTeX ($...$ inline, $$...$$ block).
2. Reconstruct any garbled or incomplete formulas.
3. Provide a thorough step-by-step solution in the "note" field.

Return ONLY a valid JSON object (no markdown, no extra text):
{
  "questionText": "...",
  "optionA": "...",
  "optionB": "...",
  "optionC": "...",
  "optionD": "...",
  "correctAnswer": "A",
  "subject": "...",
  "note": "..."
}`;

async function setAiStage(paperId: number, stage: string) {
  await db.update(papersTable)
    .set({ aiProcessingStage: stage })
    .where(eq(papersTable.id, paperId));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 5000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand");
      if (is503 && i < retries) {
        const wait = delayMs * Math.pow(2, i);
        logger.warn({ attempt: i + 1, waitMs: wait }, "Gemini 503, retrying...");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

function safeParseGeminiJson<T>(raw: string, finishReason?: string): T {
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Gemini returned empty response (finishReason: ${finishReason ?? "unknown"})`);
  }
  if (finishReason === "MAX_TOKENS") {
    throw new Error("Gemini response was cut off — output too long. Paper may have too many questions for a single call.");
  }
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error(`Gemini returned no valid JSON. Response starts with: "${text.slice(0, 100)}"`);
  const jsonStr = objMatch[0];
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    const repaired = jsonrepair(jsonStr);
    return JSON.parse(repaired) as T;
  }
}

async function runAiExtraction(paperId: number): Promise<void> {
  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper || !paper.fullPdfText || paper.fullPdfText.trim().length < 50) {
    throw new Error("Paper has no extracted text. Run standard extraction first.");
  }

  await db.update(papersTable)
    .set({ aiExtractionStatus: "processing", aiExtractionError: null, aiProcessingStage: "flash_extract" })
    .where(eq(papersTable.id, paperId));

  let flashResult: {
    fullCleanText: string;
    questions: Array<{
      questionNumber: number;
      questionText: string;
      optionA: string | null;
      optionB: string | null;
      optionC: string | null;
      optionD: string | null;
      correctAnswer: string | null;
      subject: string | null;
      note: string | null;
      needsProReview: boolean;
    }>;
  };

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\n---RAW PDF TEXT---\n${paper.fullPdfText.slice(0, 60000)}\n---END---` }],
      }],
      config: { maxOutputTokens: 65536, responseMimeType: "application/json" },
    }));

    const finishReason = response.candidates?.[0]?.finishReason;
    flashResult = safeParseGeminiJson(response.text ?? "", finishReason);
  } catch (err) {
    throw new Error(`Flash extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const questions = [...flashResult.questions];
  const proNeeded = questions.filter((q) => q.needsProReview);

  for (let i = 0; i < proNeeded.length; i++) {
    const q = proNeeded[i];
    await setAiStage(paperId, `pro_refine_${i + 1}_of_${proNeeded.length}`);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{
          role: "user",
          parts: [{ text: `${PRO_REFINE_PROMPT}\n\nQuestion:\n${JSON.stringify(q)}` }],
        }],
        config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
      });
      try {
        const refined = safeParseGeminiJson<Record<string, unknown>>(response.text ?? "");
        const idx = questions.findIndex((x) => x.questionNumber === q.questionNumber);
        if (idx !== -1) questions[idx] = { ...q, ...refined };
      } catch {}
    } catch (err) {
      logger.warn({ err, questionNumber: q.questionNumber }, "Pro refinement failed, keeping Flash result");
    }
  }

  await setAiStage(paperId, "saving");
  await db.delete(questionsTable).where(eq(questionsTable.paperId, paperId));

  if (questions.length > 0) {
    await db.insert(questionsTable).values(
      questions.map((q) => ({
        paperId,
        questionNumber: q.questionNumber,
        questionText: q.questionText,
        optionA: q.optionA ?? null,
        optionB: q.optionB ?? null,
        optionC: q.optionC ?? null,
        optionD: q.optionD ?? null,
        correctAnswer: q.correctAnswer ?? null,
        subject: q.subject ?? null,
        note: q.note ?? null,
        hasFigure: false,
        figureData: null,
        figureObjectPath: null,
        status: "ai_extracted",
      }))
    );
  }

  const model = proNeeded.length > 0 ? "gemini-2.5-flash + gemini-2.5-pro (hybrid)" : "gemini-2.5-flash";

  await db.update(papersTable).set({
    fullPdfText: flashResult.fullCleanText || paper.fullPdfText,
    totalQuestions: questions.length,
    aiExtractionStatus: "done",
    aiExtractionError: null,
    aiExtractionModel: model,
    aiProcessingStage: null,
  }).where(eq(papersTable.id, paperId));

  logger.info({ paperId, total: questions.length, proRefined: proNeeded.length }, "AI extraction complete");
}

export { runAiExtraction };

router.get("/ai-extract/papers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paperId = parseInt(raw, 10);
  if (isNaN(paperId)) { res.status(400).json({ error: "Invalid paper ID" }); return; }

  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  if (!paper.fullPdfText || paper.fullPdfText.trim().length < 50) {
    send({ stage: "error", message: "Paper has no extracted text. Run standard extraction first." });
    res.end();
    return;
  }

  send({ stage: "flash_extract", message: "Gemini 2.5 Flash se text extract ho raha hai..." });

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\n---RAW PDF TEXT---\n${paper.fullPdfText.slice(0, 60000)}\n---END---` }],
      }],
      config: { maxOutputTokens: 65536, responseMimeType: "application/json" },
    }));

    const flashFinishReason = response.candidates?.[0]?.finishReason;
    const flashResult = safeParseGeminiJson<{
      fullCleanText: string;
      questions: Array<{
        questionNumber: number;
        questionText: string;
        optionA: string | null;
        optionB: string | null;
        optionC: string | null;
        optionD: string | null;
        correctAnswer: string | null;
        subject: string | null;
        note: string | null;
        needsProReview: boolean;
      }>;
    }>(response.text ?? "", flashFinishReason);

    const questions = [...flashResult.questions];
    const proNeeded = questions.filter((q) => q.needsProReview);

    send({
      stage: "flash_done",
      message: `Flash ne ${questions.length} questions extract kiye. ${proNeeded.length} Pro ke liye bheje ja rahe hain...`,
      totalQuestions: questions.length,
      proCount: proNeeded.length,
    });

    for (let i = 0; i < proNeeded.length; i++) {
      const q = proNeeded[i];
      send({
        stage: "pro_refine",
        message: `Pro model: Q${q.questionNumber} refine ho raha hai (${i + 1}/${proNeeded.length})`,
        questionNumber: q.questionNumber,
      });

      try {
        const proRes = await ai.models.generateContent({
          model: "gemini-2.5-pro",
          contents: [{
            role: "user",
            parts: [{ text: `${PRO_REFINE_PROMPT}\n\nQuestion:\n${JSON.stringify(q)}` }],
          }],
          config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
        });
        try {
          const refined = safeParseGeminiJson<Record<string, unknown>>(proRes.text ?? "");
          const idx = questions.findIndex((x) => x.questionNumber === q.questionNumber);
          if (idx !== -1) questions[idx] = { ...q, ...refined };
        } catch {}
      } catch (err) {
        logger.warn({ err, questionNumber: q.questionNumber }, "Pro refinement failed, keeping Flash result");
      }
    }

    send({ stage: "saving", message: "Questions database mein save ho rahe hain..." });

    await db.delete(questionsTable).where(eq(questionsTable.paperId, paperId));
    if (questions.length > 0) {
      await db.insert(questionsTable).values(
        questions.map((q) => ({
          paperId,
          questionNumber: q.questionNumber,
          questionText: q.questionText,
          optionA: q.optionA ?? null,
          optionB: q.optionB ?? null,
          optionC: q.optionC ?? null,
          optionD: q.optionD ?? null,
          correctAnswer: q.correctAnswer ?? null,
          subject: q.subject ?? null,
          note: q.note ?? null,
          hasFigure: false,
          figureData: null,
          figureObjectPath: null,
          status: "ai_extracted",
        }))
      );
    }

    const model = proNeeded.length > 0 ? "gemini-2.5-flash + gemini-2.5-pro (hybrid)" : "gemini-2.5-flash";

    await db.update(papersTable).set({
      fullPdfText: flashResult.fullCleanText || paper.fullPdfText,
      totalQuestions: questions.length,
      aiExtractionStatus: "done",
      aiExtractionError: null,
      aiExtractionModel: model,
      aiProcessingStage: null,
    }).where(eq(papersTable.id, paperId));

    send({
      stage: "done",
      message: `Extraction complete! ${questions.length} questions extract aur save ho gaye.`,
      totalQuestions: questions.length,
      model,
      proRefined: proNeeded.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, paperId }, "AI extraction (SSE) failed");
    await db.update(papersTable)
      .set({ aiExtractionStatus: "error", aiExtractionError: msg, aiProcessingStage: null })
      .where(eq(papersTable.id, paperId));
    send({ stage: "error", message: msg });
  }

  res.end();
});

router.post("/ai-extract/papers/:id/trigger", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paperId = parseInt(raw, 10);
  if (isNaN(paperId)) { res.status(400).json({ error: "Invalid paper ID" }); return; }

  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }

  await db.update(papersTable)
    .set({ aiExtractionStatus: "processing", aiProcessingStage: "queued", aiExtractionError: null })
    .where(eq(papersTable.id, paperId));

  setImmediate(() => {
    runAiExtraction(paperId).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(papersTable)
        .set({ aiExtractionStatus: "error", aiExtractionError: msg, aiProcessingStage: null })
        .where(eq(papersTable.id, paperId));
    });
  });

  res.json({ started: true, paperId });
});

router.post("/ai-extract/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const { examName, year, shift } = req.body;
  if (!examName) { res.status(400).json({ error: "examName is required" }); return; }

  const [paper] = await db.insert(papersTable).values({
    examName,
    year: year || null,
    shift: shift || null,
    totalQuestions: 0,
    fileName: req.file.originalname,
    processingStatus: "processing",
  }).returning();

  const fileBuffer = req.file.buffer;

  setImmediate(async () => {
    try {
      await db.update(papersTable).set({ processingStage: "extracting_text" }).where(eq(papersTable.id, paper.id));
      const result = await parsePdfText(fileBuffer, (stage) =>
        db.update(papersTable).set({ processingStage: stage }).where(eq(papersTable.id, paper.id))
      );

      await db.update(papersTable).set({ processingStage: "uploading_figures" }).where(eq(papersTable.id, paper.id));
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
        totalQuestions: result.questions.length,
        fullPdfText: result.fullPdfText,
        processingStatus: "done",
        processingStage: null,
      }).where(eq(papersTable.id, paper.id));

    } catch (err) {
      await db.update(papersTable).set({
        processingStatus: "error",
        processingError: String(err),
        processingStage: null,
      }).where(eq(papersTable.id, paper.id));
    }
  });

  res.json({ paperId: paper.id, processing: true });
});

router.post("/ai-extract/batch/start", async (req, res): Promise<void> => {
  const { zipObjectPath, zipFileName } = req.body;
  if (!zipObjectPath) { res.status(400).json({ error: "zipObjectPath is required" }); return; }

  const { batchJobsTable: batchJobs } = await import("@workspace/db/schema");

  const [job] = await db.insert(batchJobs).values({
    zipObjectPath,
    zipFileName: zipFileName || null,
    status: "pending",
    aiExtract: "true",
  }).returning();

  const { processBatchInBackground } = await import("./ai-batch.js");
  processBatchInBackground(job.id).catch(console.error);

  res.json({ jobId: job.id });
});

export default router;
