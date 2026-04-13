import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { papersTable, questionsTable } from "@workspace/db/schema";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export const SYSTEM_PROMPT = `You are an expert at extracting and structuring exam questions from raw text of Indian competitive exam PDFs (UPSC, RRB, SSC, JEE, NEET, etc.).

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

export const PRO_REFINE_PROMPT = `You are an expert exam question formatter. Refine the following question:
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

export type FlashQuestion = {
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
};

export async function runAiExtraction(paperId: number): Promise<void> {
  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, paperId));
  if (!paper?.fullPdfText || paper.fullPdfText.trim().length < 50) {
    throw new Error("Paper has no extracted text. Run standard extraction first.");
  }

  await db.update(papersTable)
    .set({ aiExtractionStatus: "processing", aiExtractionError: null, aiProcessingStage: "flash_extract" })
    .where(eq(papersTable.id, paperId));

  const flashResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [{ text: `${SYSTEM_PROMPT}\n\n---RAW PDF TEXT---\n${paper.fullPdfText.slice(0, 60000)}\n---END---` }],
    }],
    config: { maxOutputTokens: 8192 },
  });

  const flashRaw = flashResponse.text ?? "";
  const flashMatch = flashRaw.match(/\{[\s\S]*\}/);
  if (!flashMatch) throw new Error("Gemini Flash returned no valid JSON");

  const flashResult = JSON.parse(flashMatch[0]) as { fullCleanText: string; questions: FlashQuestion[] };
  const questions = [...flashResult.questions];
  const proNeeded = questions.filter((q) => q.needsProReview);

  for (let i = 0; i < proNeeded.length; i++) {
    const q = proNeeded[i];
    await db.update(papersTable)
      .set({ aiProcessingStage: `pro_${i + 1}_of_${proNeeded.length}` })
      .where(eq(papersTable.id, paperId));

    try {
      const proRes = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{
          role: "user",
          parts: [{ text: `${PRO_REFINE_PROMPT}\n\nQuestion:\n${JSON.stringify(q)}` }],
        }],
        config: { maxOutputTokens: 8192 },
      });
      const proRaw = proRes.text ?? "";
      const proMatch = proRaw.match(/\{[\s\S]*\}/);
      if (proMatch) {
        const refined = JSON.parse(proMatch[0]);
        const idx = questions.findIndex((x) => x.questionNumber === q.questionNumber);
        if (idx !== -1) questions[idx] = { ...q, ...refined };
      }
    } catch (err) {
      logger.warn({ err, questionNumber: q.questionNumber }, "Pro refinement failed, keeping Flash result");
    }
  }

  await db.update(papersTable).set({ aiProcessingStage: "saving" }).where(eq(papersTable.id, paperId));
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
