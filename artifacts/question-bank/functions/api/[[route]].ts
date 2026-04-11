import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, count } from "drizzle-orm";
import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

// ─── Schema (inline to avoid Node.js deps from @workspace/db) ────────────────

const papersTable = pgTable("papers", {
  id: serial("id").primaryKey(),
  examName: text("exam_name").notNull(),
  year: text("year"),
  shift: text("shift"),
  totalQuestions: integer("total_questions").default(0),
  fileName: text("file_name"),
  processingStatus: text("processing_status").default("done"),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

const questionsTable = pgTable("questions", {
  id: serial("id").primaryKey(),
  paperId: integer("paper_id").references(() => papersTable.id),
  questionNumber: integer("question_number").notNull(),
  questionIdOriginal: text("question_id_original"),
  questionText: text("question_text").notNull(),
  optionA: text("option_a"),
  optionB: text("option_b"),
  optionC: text("option_c"),
  optionD: text("option_d"),
  correctAnswer: text("correct_answer"),
  chosenOption: text("chosen_option"),
  status: text("status"),
  hasFigure: boolean("has_figure").default(false),
  figureData: text("figure_data"),
  subject: text("subject"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Env = {
  NEON_DATABASE_URL: string;
};

function getDb(env: Env) {
  const sql = neon(env.NEON_DATABASE_URL);
  return drizzle(sql, { schema: { papersTable, questionsTable } });
}

// ─── Pure-JS PDF Parser (no system binaries) ──────────────────────────────────

interface ParsedQuestion {
  questionNumber: number;
  questionIdOriginal: string | null;
  questionText: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string | null;
  chosenOption: string | null;
  status: string | null;
  hasFigure: boolean;
  figureData: null;
  note: string | null;
}

function cleanText(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\s+/g, " ");
}

function detectFormat(text: string): "format_2016" | "format_2025" | "unknown" {
  if (text.includes("Chosen Option") && text.includes("Question ID")) {
    return "format_2016";
  }
  if (text.includes("Section :") || text.match(/Q\.\d+\s+[A-Z]/)) {
    return "format_2025";
  }
  return "unknown";
}

function extract2016QuestionNumber(block: string): number | null {
  const splitNumberMatch = block.match(/Q\.\s*(\d+)\s*\n\s*(\d+)\s+Question ID/);
  if (splitNumberMatch) return Number(`${splitNumberMatch[1]}${splitNumberMatch[2]}`);
  const qNumMatch = block.match(/Q\.(\d+)/);
  if (qNumMatch) return Number(qNumMatch[1]);
  const subQuestionMatch = block.match(/SubQuestion No\s*:\s*(\d+)/);
  return subQuestionMatch ? Number(subQuestionMatch[1]) : null;
}

function parse2016Format(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const qBlocks = text.match(/(?:^|\n)\s*Q\.\d+\b[\s\S]*?(?=\n\s*Q\.\d+\b|$)/g) || [];

  for (const block of qBlocks) {
    const questionNumber = extract2016QuestionNumber(block);
    if (!questionNumber) continue;

    const qIdMatch = block.match(/Question ID\s*:\s*(\d+)/);
    const questionIdOriginal = qIdMatch ? qIdMatch[1] : null;
    const statusMatch = block.match(/Status\s*:\s*(\w+)/);
    const status = statusMatch ? statusMatch[1] : null;
    const chosenMatch = block.match(/Chosen Option\s*:\s*(\d+)/);
    const chosenOption = chosenMatch ? chosenMatch[1] : null;

    let questionText = "";
    const comprehensionMatch = block.match(/Comprehension:([\s\S]*?)(?=SubQuestion|Q\.\d|$)/i);
    if (comprehensionMatch) questionText = cleanText(comprehensionMatch[1]);

    const subQuestionMatch = block.match(/SubQuestion No\s*:\s*\d+/);
    if (subQuestionMatch) {
      const afterSub = block.substring(block.indexOf(subQuestionMatch[0]) + subQuestionMatch[0].length);
      const subText = afterSub.match(/Q\.\d+\s*([\s\S]*?)(?=Ans\s)/);
      if (subText) questionText = (questionText + " " + cleanText(subText[1])).trim();
    }

    if (!questionText) {
      const mainTextMatch = block.match(/Q\.\d+\s*([\s\S]*?)(?=Question ID|Ans\s)/);
      if (mainTextMatch) questionText = cleanText(mainTextMatch[1]);
    }

    let optionA: string | null = null;
    let optionB: string | null = null;
    let optionC: string | null = null;
    let optionD: string | null = null;
    let correctAnswer: string | null = null;
    let note: string | null = null;

    const ansSection = block.match(/Ans\s+([\s\S]*?)$/);
    if (ansSection) {
      const ansText = ansSection[1];
      const opt1Match = ansText.match(/1\.\s*(.*?)(?=\s*2\.|$)/s);
      const opt2Match = ansText.match(/2\.\s*(.*?)(?=\s*3\.|$)/s);
      const opt3Match = ansText.match(/3\.\s*(.*?)(?=\s*4\.|$)/s);
      const opt4Match = ansText.match(/4\.\s*(.*?)(?=\s*Note:|$)/s);
      if (opt1Match) optionA = cleanText(opt1Match[1]);
      if (opt2Match) optionB = cleanText(opt2Match[1]);
      if (opt3Match) optionC = cleanText(opt3Match[1]);
      if (opt4Match) optionD = cleanText(opt4Match[1]);

      const noteMatch = ansText.match(/Note:\s*(.*?)$/s);
      note = noteMatch ? cleanText(noteMatch[1]) : null;

      const greenTickLine = ansText.split("\n").find((line) => line.trim().match(/^\d+\.\s+\w/));
      if (greenTickLine) {
        const tickMatch = greenTickLine.match(/^(\d+)\./);
        if (tickMatch) {
          const optNum = parseInt(tickMatch[1], 10);
          const ansMap: Record<number, string> = { 1: "A", 2: "B", 3: "C", 4: "D" };
          correctAnswer = ansMap[optNum] || null;
        }
      }
      if (!correctAnswer && optionA) correctAnswer = "A";
    }

    questions.push({
      questionNumber,
      questionIdOriginal,
      questionText: questionText || `[Question ${questionNumber}]`,
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer,
      chosenOption,
      status,
      hasFigure: false,
      figureData: null,
      note,
    });
  }

  return questions;
}

function parse2025Format(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const qBlocks = text.match(/(?:^|\n)\s*Q\.\d+\b[\s\S]*?(?=\n\s*Q\.\d+\b|$)/g) || [];

  for (const block of qBlocks) {
    const qNumMatch = block.match(/^\s*Q\.(\d+)/);
    if (!qNumMatch) continue;
    const questionNumber = parseInt(qNumMatch[1], 10);

    const ansMatch = block.match(/\n\s*Ans\b/);
    if (!ansMatch || ansMatch.index === undefined) continue;

    const qNumStr = qNumMatch[0];
    const rawQuestionText = block.substring(qNumStr.length, ansMatch.index);
    const questionText = cleanText(rawQuestionText) || `[Question ${questionNumber}]`;

    const ansSection = block.substring(ansMatch.index);
    const optAMatch = ansSection.match(/\bA\.\s*(.*?)(?=\s*\bB\.|$)/s);
    const optBMatch = ansSection.match(/\bB\.\s*(.*?)(?=\s*\bC\.|$)/s);
    const optCMatch = ansSection.match(/\bC\.\s*(.*?)(?=\s*\bD\.|$)/s);
    const optDMatch = ansSection.match(/\bD\.\s*(.*?)$/s);

    const correctMarker = ansSection.match(/\b([A-D])\./);

    questions.push({
      questionNumber,
      questionIdOriginal: null,
      questionText,
      optionA: optAMatch ? cleanText(optAMatch[1]) : null,
      optionB: optBMatch ? cleanText(optBMatch[1]) : null,
      optionC: optCMatch ? cleanText(optCMatch[1]) : null,
      optionD: optDMatch ? cleanText(optDMatch[1]) : null,
      correctAnswer: correctMarker ? correctMarker[1] : null,
      chosenOption: null,
      status: null,
      hasFigure: false,
      figureData: null,
      note: null,
    });
  }

  return questions;
}

function extractExamName(text: string): string {
  const subjectMatch = text.match(/Subject\s*:?\s*(.*?)(?:\n|$)/i);
  if (subjectMatch) return cleanText(subjectMatch[1]);
  const rrbMatch = text.match(/(RRB\s+NTPC.*?)(?:\n|$)/i);
  if (rrbMatch) return cleanText(rrbMatch[1]);
  return "Unknown Exam";
}

async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function parsePdfBuffer(buffer: ArrayBuffer): Promise<{ questions: ParsedQuestion[]; examName: string }> {
  const text = await extractTextFromPdf(buffer);
  const format = detectFormat(text);

  let questions: ParsedQuestion[];
  if (format === "format_2016") {
    questions = parse2016Format(text);
  } else if (format === "format_2025") {
    questions = parse2025Format(text);
  } else {
    questions = parse2025Format(text);
    if (questions.length === 0) questions = parse2016Format(text);
  }

  return { questions, examName: extractExamName(text) };
}

// ─── Background processor ─────────────────────────────────────────────────────

async function processPdfBackground(
  paperId: number,
  buffer: ArrayBuffer,
  db: ReturnType<typeof getDb>,
): Promise<void> {
  try {
    const { questions, examName } = await parsePdfBuffer(buffer);

    if (questions.length > 0) {
      await db.insert(questionsTable).values(
        questions.map((q) => ({
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
          hasFigure: false,
          figureData: null,
          note: q.note,
        }))
      );
    }

    await db
      .update(papersTable)
      .set({ totalQuestions: questions.length, processingStatus: "done", examName })
      .where(eq(papersTable.id, paperId));
  } catch (err) {
    await db
      .update(papersTable)
      .set({ processingStatus: "error", processingError: String(err) })
      .where(eq(papersTable.id, paperId));
  }
}

// ─── Hono App ─────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// GET /api/papers
app.get("/api/papers", async (c) => {
  const db = getDb(c.env);
  const papers = await db.select().from(papersTable).orderBy(papersTable.createdAt);
  return c.json(papers);
});

// GET /api/papers/:id
app.get("/api/papers/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid paper ID" }, 400);
  const db = getDb(c.env);
  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, id));
  if (!paper) return c.json({ error: "Paper not found" }, 404);
  return c.json(paper);
});

// GET /api/papers/:id/questions
app.get("/api/papers/:id/questions", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid paper ID" }, 400);
  const db = getDb(c.env);
  const questions = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.paperId, id))
    .orderBy(questionsTable.questionNumber);
  return c.json(questions);
});

// POST /api/papers/upload
app.post("/api/papers/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const examName = formData.get("examName") as string | null;

  if (!file) return c.json({ error: "No file uploaded" }, 400);
  if (!examName) return c.json({ error: "examName is required" }, 400);

  const db = getDb(c.env);
  const [paper] = await db
    .insert(papersTable)
    .values({
      examName,
      year: (formData.get("year") as string) || null,
      shift: (formData.get("shift") as string) || null,
      totalQuestions: 0,
      fileName: file.name,
      processingStatus: "processing",
    })
    .returning();

  const buffer = await file.arrayBuffer();
  c.executionCtx.waitUntil(processPdfBackground(paper.id, buffer, db));

  return c.json({
    success: true,
    paperId: paper.id,
    processing: true,
    totalQuestions: 0,
    message: "PDF uploaded. Extracting questions in background...",
  });
});

// POST /api/papers/:id/process-attached
app.post("/api/papers/:id/process-attached", async (c) => {
  return c.json(
    {
      error: "Attached PDF processing is not available in Cloudflare Pages deployment. Please upload PDFs directly.",
    },
    501
  );
});

// GET /api/questions/stats
app.get("/api/questions/stats", async (c) => {
  const db = getDb(c.env);
  const [paperCount] = await db.select({ count: count() }).from(papersTable);
  const [questionCount] = await db.select({ count: count() }).from(questionsTable);
  const [figureCount] = await db
    .select({ count: count() })
    .from(questionsTable)
    .where(eq(questionsTable.hasFigure, true));

  const bySubject = await db
    .select({ subject: questionsTable.subject, count: count() })
    .from(questionsTable)
    .groupBy(questionsTable.subject);

  return c.json({
    totalPapers: paperCount.count,
    totalQuestions: questionCount.count,
    withFigures: figureCount.count,
    bySubject,
  });
});

// GET /api/questions
app.get("/api/questions", async (c) => {
  const db = getDb(c.env);
  const { subject, hasFigure, paperId } = c.req.query();

  let query = db.select().from(questionsTable);

  if (subject) query = query.where(eq(questionsTable.subject, subject)) as typeof query;
  if (hasFigure === "true") query = query.where(eq(questionsTable.hasFigure, true)) as typeof query;
  if (paperId) {
    const pid = parseInt(paperId, 10);
    if (!isNaN(pid)) query = query.where(eq(questionsTable.paperId, pid)) as typeof query;
  }

  const questions = await query.orderBy(questionsTable.questionNumber);
  return c.json(questions);
});

// GET /api/questions/:id
app.get("/api/questions/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid question ID" }, 400);
  const db = getDb(c.env);
  const [question] = await db.select().from(questionsTable).where(eq(questionsTable.id, id));
  if (!question) return c.json({ error: "Question not found" }, 404);
  return c.json(question);
});

export const onRequest = handle(app);
