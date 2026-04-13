import { Router, type IRouter } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { jsonrepair } from "jsonrepair";
import { db } from "@workspace/db";
import { papersTable, questionsTable } from "@workspace/db/schema";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
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

const SYSTEM_PROMPT = `You are an expert at extracting and structuring exam questions from Indian competitive exam PDFs (UPSC, RRB, SSC, JEE, NEET, etc.).

Your task:
1. Extract ALL questions from the provided content.
2. Clean up any OCR artifacts, broken lines, garbled characters, and incomplete sentences.
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

const VISION_SYSTEM_PROMPT = `You are an expert at extracting and structuring exam questions from Indian competitive exam PDFs (UPSC, RRB, SSC, JEE, NEET, etc.).

You are given the full PDF document. Read ALL pages carefully including:
- Hindi and English text
- Mathematical formulas and equations
- Diagrams/figures descriptions
- Answer options

Your task:
1. Extract ALL questions from every page of the PDF.
2. For ALL mathematical expressions: use LaTeX notation ($...$ inline, $$...$$ block).
3. For each question, identify the subject.
4. The "note" field: detailed step-by-step solution.
5. The "correctAnswer" must be one of: "A", "B", "C", or "D".
6. If a question references a figure/diagram, describe it briefly in the question text in [brackets].
7. Set "needsProReview" to true for complex formula-heavy math questions.

Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "fullCleanText": "complete clean version of all extracted text",
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

function isRetriableError(msg: string): { is503: boolean; is429: boolean } {
  const is503 = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("overloaded") || msg.includes("high demand");
  const is429 = msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("resource_exhausted");
  return { is503, is429 };
}

async function withRetry<T>(fn: () => Promise<T>, retries = 10, delayMs = 5000): Promise<T> {
  const MAX_WAIT_503 = 120_000;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { is503, is429 } = isRetriableError(msg);
      if ((is503 || is429) && i < retries) {
        const wait = is429
          ? 65000 + i * 10000
          : Math.min(delayMs * Math.pow(2, i), MAX_WAIT_503);
        logger.warn({ attempt: i + 1, waitMs: wait, is429, is503 }, "Gemini error, retrying after wait...");
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

type ExtractionResult = {
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

async function runVisionExtraction(paperId: number, pdfObjectPath: string): Promise<ExtractionResult> {
  logger.info({ paperId, pdfObjectPath }, "Starting Gemini Vision extraction via Files API");
  await setAiStage(paperId, "vision_downloading_pdf");

  const pdfBuffer = await storage.downloadObject(pdfObjectPath);

  await setAiStage(paperId, "vision_uploading_to_gemini");
  logger.info({ paperId, sizeKb: Math.round(pdfBuffer.length / 1024) }, "Uploading PDF to Gemini Files API");

  // Upload PDF directly — no image conversion needed
  const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });
  const uploadedFile = await withRetry(() => ai.files.upload({
    file: pdfBlob,
    config: { mimeType: "application/pdf", displayName: `paper-${paperId}.pdf` },
  }));

  // Wait for file to be ready (usually instant for PDFs < 20MB)
  let fileInfo = uploadedFile;
  let waitMs = 0;
  while (fileInfo.state === "PROCESSING" && waitMs < 60000) {
    await new Promise((r) => setTimeout(r, 2000));
    fileInfo = await ai.files.get({ name: fileInfo.name! });
    waitMs += 2000;
  }

  if (fileInfo.state === "FAILED") {
    await ai.files.delete({ name: fileInfo.name! }).catch(() => {});
    throw new Error("Gemini Files API: PDF processing failed");
  }

  logger.info({ paperId, fileName: fileInfo.name, state: fileInfo.state }, "PDF ready in Gemini Files API, starting extraction");
  await setAiStage(paperId, "vision_extracting");

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { fileData: { fileUri: fileInfo.uri!, mimeType: "application/pdf" } },
          { text: VISION_SYSTEM_PROMPT },
        ],
      }],
      config: { maxOutputTokens: 65536, responseMimeType: "application/json" },
    }));

    const finishReason = response.candidates?.[0]?.finishReason;
    return safeParseGeminiJson<ExtractionResult>(response.text ?? "", finishReason);
  } finally {
    await ai.files.delete({ name: fileInfo.name! }).catch(() => {});
  }
}

async function runAiExtraction(paperId: number): Promise<void> {
  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper) throw new Error("Paper not found.");

  // Always use Gemini Vision when a stored PDF is available (AI Extract always stores PDF)
  const useVision = !!paper.pdfObjectPath;
  const hasText = paper.fullPdfText && paper.fullPdfText.trim().length >= 50;

  if (!useVision && !hasText) {
    throw new Error("Paper has no stored PDF for Vision extraction. Please re-upload.");
  }

  await db.update(papersTable)
    .set({ aiExtractionStatus: "processing", aiExtractionError: null, aiProcessingStage: useVision ? "vision_downloading_pdf" : "flash_extract" })
    .where(eq(papersTable.id, paperId));

  let flashResult: ExtractionResult;

  if (useVision) {
    try {
      flashResult = await runVisionExtraction(paperId, paper.pdfObjectPath!);
    } catch (err) {
      throw new Error(`Vision extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    try {
      const response = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [{ text: `${SYSTEM_PROMPT}\n\n---RAW PDF TEXT---\n${paper.fullPdfText!.slice(0, 60000)}\n---END---` }],
        }],
        config: { maxOutputTokens: 65536, responseMimeType: "application/json" },
      }));

      const finishReason = response.candidates?.[0]?.finishReason;
      flashResult = safeParseGeminiJson(response.text ?? "", finishReason);
    } catch (err) {
      throw new Error(`Flash extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const questions = [...flashResult.questions];
  const proNeeded = questions.filter((q) => q.needsProReview);

  for (let i = 0; i < proNeeded.length; i++) {
    const q = proNeeded[i];
    await setAiStage(paperId, `pro_refine_${i + 1}_of_${proNeeded.length}`);
    try {
      const response = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{
          role: "user",
          parts: [{ text: `${PRO_REFINE_PROMPT}\n\nQuestion:\n${JSON.stringify(q)}` }],
        }],
        config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
      }));
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

  const modeLabel = useVision
    ? (proNeeded.length > 0 ? "gemini-2.5-flash (vision) + gemini-2.5-pro (hybrid)" : "gemini-2.5-flash (vision)")
    : (proNeeded.length > 0 ? "gemini-2.5-flash + gemini-2.5-pro (hybrid)" : "gemini-2.5-flash");

  await db.update(papersTable).set({
    fullPdfText: flashResult.fullCleanText || paper.fullPdfText,
    totalQuestions: questions.length,
    aiExtractionStatus: "done",
    aiExtractionError: null,
    aiExtractionModel: modeLabel,
    aiProcessingStage: null,
  }).where(eq(papersTable.id, paperId));

  logger.info({ paperId, total: questions.length, proRefined: proNeeded.length, useVision }, "AI extraction complete");
}

async function runWithAutoRestart(paperId: number): Promise<void> {
  const OUTER_RETRIES = 3;
  const OUTER_WAIT_MS = 3 * 60 * 1000;
  for (let attempt = 0; attempt <= OUTER_RETRIES; attempt++) {
    try {
      await runAiExtraction(paperId);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { is503, is429 } = isRetriableError(msg);
      if ((is503 || is429) && attempt < OUTER_RETRIES) {
        logger.warn({ attempt: attempt + 1, paperId }, `All inner retries exhausted. Waiting ${OUTER_WAIT_MS / 60000}min before full restart...`);
        await db.update(papersTable)
          .set({ aiExtractionStatus: "processing", aiProcessingStage: "waiting_retry", aiExtractionError: null })
          .where(eq(papersTable.id, paperId));
        await new Promise((r) => setTimeout(r, OUTER_WAIT_MS));
        await db.update(papersTable)
          .set({ aiProcessingStage: "flash_extract" })
          .where(eq(papersTable.id, paperId));
      } else {
        logger.error({ err, paperId }, "Background AI extraction failed permanently");
        await db.update(papersTable)
          .set({ aiExtractionStatus: "error", aiExtractionError: msg, aiProcessingStage: null })
          .where(eq(papersTable.id, paperId));
        return;
      }
    }
  }
}

export { runAiExtraction };

const STAGE_MESSAGES: Record<string, string> = {
  flash_extract: "Gemini 2.5 Flash se text extract ho raha hai...",
  saving: "Questions database mein save ho rahe hain...",
  waiting_retry: "Gemini abhi busy hai — 3 minute mein automatic retry hogi...",
  vision_downloading_pdf: "PDF download ho raha hai...",
  vision_converting_pages: "PDF process ho raha hai...",
  vision_uploading_to_gemini: "PDF Gemini Files API mein upload ho raha hai...",
  vision_extracting: "Gemini Vision puri PDF padh raha hai aur questions extract kar raha hai...",
};

function stageToMessage(stage: string): string {
  if (STAGE_MESSAGES[stage]) return STAGE_MESSAGES[stage];
  const proMatch = stage.match(/^pro_refine_(\d+)_of_(\d+)$/);
  if (proMatch) return `Pro model: Question ${proMatch[1]} of ${proMatch[2]} refine ho raha hai...`;
  return "Processing...";
}

router.get("/ai-extract/papers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paperId = parseInt(raw, 10);
  if (isNaN(paperId)) { res.status(400).json({ error: "Invalid paper ID" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper) {
    send({ stage: "error", message: "Paper not found" });
    res.end();
    return;
  }

  const hasText = paper.fullPdfText && paper.fullPdfText.trim().length >= 50;
  const hasVision = !!paper.pdfObjectPath;

  if (!hasText && !hasVision) {
    send({ stage: "error", message: "Paper has no extracted text and no stored PDF for vision extraction." });
    res.end();
    return;
  }

  if (paper.aiExtractionStatus === "done") {
    send({ stage: "done", message: `${paper.totalQuestions} questions already extracted.`, totalQuestions: paper.totalQuestions, model: paper.aiExtractionModel });
    res.end();
    return;
  }

  if (paper.aiExtractionStatus !== "processing") {
    const willUseVision = hasVision; // Always use Vision when PDF is stored
    await db.update(papersTable)
      .set({ aiExtractionStatus: "processing", aiExtractionError: null, aiProcessingStage: willUseVision ? "vision_downloading_pdf" : "flash_extract" })
      .where(eq(papersTable.id, paperId));

    setImmediate(() => { runWithAutoRestart(paperId); });
  }

  const initialStage = paper.aiProcessingStage ?? "flash_extract";
  send({ stage: initialStage, message: stageToMessage(initialStage) });

  let lastStage: string | null = paper.aiProcessingStage;
  let closed = false;

  const poll = setInterval(async () => {
    if (closed) { clearInterval(poll); return; }
    try {
      const [updated] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
      if (!updated) return;

      if (updated.aiExtractionStatus === "done") {
        clearInterval(poll);
        send({
          stage: "done",
          message: `Extraction complete! ${updated.totalQuestions} questions extract ho gaye.`,
          totalQuestions: updated.totalQuestions,
          model: updated.aiExtractionModel,
        });
        res.end();
        return;
      }

      if (updated.aiExtractionStatus === "error") {
        clearInterval(poll);
        send({ stage: "error", message: updated.aiExtractionError ?? "Extraction failed" });
        res.end();
        return;
      }

      const currentStage = updated.aiProcessingStage;
      if (currentStage && currentStage !== lastStage) {
        lastStage = currentStage;
        send({ stage: currentStage, message: stageToMessage(currentStage) });
      }
    } catch {}
  }, 2000);

  res.on("close", () => {
    closed = true;
    clearInterval(poll);
  });
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

  setImmediate(() => { runWithAutoRestart(paperId); });

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
    processingStage: "storing_pdf",
  }).returning();

  const fileBuffer = req.file.buffer;

  setImmediate(async () => {
    try {
      // Skip old OCR pipeline — store PDF directly to B2 for Gemini Vision extraction
      const pdfKey = `papers/${paper.id}/original.pdf`;
      const pdfObjectPath = await storage.uploadBuffer(pdfKey, fileBuffer, "application/pdf");
      logger.info({ paperId: paper.id, pdfObjectPath }, "PDF stored to B2 for Gemini Vision extraction");

      await db.update(papersTable).set({
        processingStatus: "done",
        processingStage: null,
        pdfObjectPath,
        fullPdfText: "",
      }).where(eq(papersTable.id, paper.id));

    } catch (err) {
      logger.error({ err, paperId: paper.id }, "Failed to store PDF to B2 for Vision extraction");
      await db.update(papersTable).set({
        processingStatus: "error",
        processingError: `Failed to store PDF for AI Vision extraction: ${String(err)}`,
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
