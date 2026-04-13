import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { papersTable, questionsTable } from "@workspace/db/schema";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are an expert at extracting and structuring exam questions from raw text extracted from PDF question papers (like UPSC, RRB, SSC, JEE, NEET, etc.).

Your task:
1. Extract ALL questions from the provided raw text.
2. Clean up OCR artifacts, broken lines, garbled characters, and incomplete sentences.
3. For ALL mathematical expressions, formulas, equations, and reasoning steps: use LaTeX notation.
   - Inline math: wrap in $...$ (e.g., $x^2 + y^2 = z^2$)
   - Block/display math: wrap in $$...$$ (e.g., $$\\int_0^\\infty e^{-x} dx = 1$$)
4. For each question, identify the subject (Mathematics, Physics, Chemistry, Biology, History, Geography, General Science, Reasoning, English, Hindi, etc.)
5. The "note" field should contain a detailed explanation/solution of the question.
6. The "correctAnswer" must be one of: "A", "B", "C", or "D".
7. Set "needsProReview" to true if the question contains complex mathematical derivations, multi-step reasoning, or references a diagram/figure.

Return ONLY a valid JSON object in this exact format (no markdown, no extra text):
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

const PRO_REFINE_PROMPT = `You are an expert exam question formatter. The following question may contain complex mathematics, multi-step reasoning, or references to a diagram/figure.

Your task:
1. Ensure ALL mathematical expressions are in proper LaTeX format ($...$ for inline, $$...$$ for block).
2. Reconstruct any formula that seems garbled or incomplete.
3. Provide a thorough step-by-step solution in the "note" field.
4. If the question references a figure/diagram, describe what the diagram likely shows in the "note" field.

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

function sseWrite(res: any, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function extractWithFlash(text: string): Promise<{
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
}> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\n---RAW PDF TEXT START---\n${text}\n---RAW PDF TEXT END---`,
          },
        ],
      },
    ],
    config: { maxOutputTokens: 8192 },
  });

  const raw = response.text ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini Flash returned no valid JSON");
  return JSON.parse(jsonMatch[0]);
}

async function refineWithPro(q: {
  questionText: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string | null;
  subject: string | null;
  note: string | null;
}): Promise<typeof q> {
  const input = JSON.stringify({
    questionText: q.questionText,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    correctAnswer: q.correctAnswer,
    subject: q.subject,
    note: q.note,
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${PRO_REFINE_PROMPT}\n\nQuestion to refine:\n${input}`,
          },
        ],
      },
    ],
    config: { maxOutputTokens: 8192 },
  });

  const raw = response.text ?? "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return q;
  try {
    return { ...q, ...JSON.parse(jsonMatch[0]) };
  } catch {
    return q;
  }
}

router.post("/ai-extract/papers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paperId = parseInt(raw, 10);

  if (isNaN(paperId)) {
    res.status(400).json({ error: "Invalid paper ID" });
    return;
  }

  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper) {
    res.status(404).json({ error: "Paper not found" });
    return;
  }

  if (!paper.fullPdfText || paper.fullPdfText.trim().length < 100) {
    res.status(400).json({ error: "Paper has no extracted text. Please run the standard extraction first." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  await db.update(papersTable)
    .set({ aiExtractionStatus: "processing", aiExtractionError: null })
    .where(eq(papersTable.id, paperId));

  try {
    sseWrite(res, { stage: "flash_extract", message: "Gemini 2.5 Flash se text extract ho raha hai..." });

    const flashResult = await extractWithFlash(paper.fullPdfText);

    const totalQuestions = flashResult.questions.length;
    const proNeeded = flashResult.questions.filter((q) => q.needsProReview);

    sseWrite(res, {
      stage: "flash_done",
      message: `Flash ne ${totalQuestions} questions extract kiye. ${proNeeded.length} questions Pro review ke liye bheje ja rahe hain...`,
      totalQuestions,
      proCount: proNeeded.length,
    });

    const refinedMap = new Map<number, (typeof flashResult.questions)[0]>();
    for (let i = 0; i < flashResult.questions.length; i++) {
      refinedMap.set(i, flashResult.questions[i]);
    }

    let proProcessed = 0;
    for (let i = 0; i < flashResult.questions.length; i++) {
      const q = flashResult.questions[i];
      if (!q.needsProReview) continue;

      sseWrite(res, {
        stage: "pro_refine",
        message: `Pro model: Question ${q.questionNumber} refine ho raha hai... (${++proProcessed}/${proNeeded.length})`,
        questionNumber: q.questionNumber,
      });

      try {
        const refined = await refineWithPro(q);
        refinedMap.set(i, { ...q, ...refined });
      } catch (err) {
        logger.warn({ err, questionNumber: q.questionNumber }, "Pro refinement failed, keeping Flash result");
      }
    }

    sseWrite(res, { stage: "saving", message: "Questions database mein save ho rahe hain..." });

    await db.delete(questionsTable).where(eq(questionsTable.paperId, paperId));

    const finalQuestions = Array.from(refinedMap.values());

    if (finalQuestions.length > 0) {
      await db.insert(questionsTable).values(
        finalQuestions.map((q) => ({
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

    const modelUsed = proNeeded.length > 0 ? "gemini-2.5-flash + gemini-2.5-pro (hybrid)" : "gemini-2.5-flash";

    await db.update(papersTable)
      .set({
        fullPdfText: flashResult.fullCleanText || paper.fullPdfText,
        totalQuestions: finalQuestions.length,
        aiExtractionStatus: "done",
        aiExtractionError: null,
        aiExtractionModel: modelUsed,
      })
      .where(eq(papersTable.id, paperId));

    sseWrite(res, {
      stage: "done",
      message: `AI extraction complete! ${finalQuestions.length} questions extracted aur save ho gaye.`,
      totalQuestions: finalQuestions.length,
      model: modelUsed,
      proRefined: proNeeded.length,
    });

    logger.info({ paperId, totalQuestions: finalQuestions.length, proRefined: proNeeded.length }, "AI extraction completed");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, paperId }, "AI extraction failed");

    await db.update(papersTable)
      .set({ aiExtractionStatus: "error", aiExtractionError: errorMsg })
      .where(eq(papersTable.id, paperId));

    sseWrite(res, { stage: "error", message: `Error: ${errorMsg}` });
  }

  res.end();
});

export default router;
