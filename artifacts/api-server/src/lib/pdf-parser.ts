import { logger } from "./logger";

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
  note: string | null;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  examName: string;
  detectedFormat: string;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

function parse2016Format(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];

  const qBlocks = text.split(/(?=\s*Q\.\d+\s)/);

  for (const block of qBlocks) {
    const qNumMatch = block.match(/Q\.(\d+)/);
    if (!qNumMatch) continue;

    const questionNumber = parseInt(qNumMatch[1], 10);

    const qIdMatch = block.match(/Question ID\s*:\s*(\d+)/);
    const questionIdOriginal = qIdMatch ? qIdMatch[1] : null;

    const statusMatch = block.match(/Status\s*:\s*(\w+)/);
    const status = statusMatch ? statusMatch[1] : null;

    const chosenMatch = block.match(/Chosen Option\s*:\s*(\d+)/);
    const chosenOption = chosenMatch ? chosenMatch[1] : null;

    const comprehensionMatch = block.match(/Comprehension:([\s\S]*?)(?=SubQuestion|Q\.\d|$)/i);
    let questionText = "";

    if (comprehensionMatch) {
      questionText = cleanText(comprehensionMatch[1]);
    }

    const subQuestionMatch = block.match(/SubQuestion No\s*:\s*\d+/);
    if (subQuestionMatch) {
      const afterSub = block.substring(block.indexOf(subQuestionMatch[0]) + subQuestionMatch[0].length);
      const subText = afterSub.match(/Q\.\d+\s*([\s\S]*?)(?=Ans\s)/);
      if (subText) {
        questionText = (questionText + " " + cleanText(subText[1])).trim();
      }
    }

    if (!questionText) {
      const mainTextMatch = block.match(/Q\.\d+\s*([\s\S]*?)(?=Question ID|Ans\s)/);
      if (mainTextMatch) {
        questionText = cleanText(mainTextMatch[1]);
      }
    }

    const hasFigure = questionText.length < 5 && !questionText.match(/[a-zA-Z]/);

    let optionA: string | null = null;
    let optionB: string | null = null;
    let optionC: string | null = null;
    let optionD: string | null = null;
    let correctAnswer: string | null = null;

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
      const note = noteMatch ? cleanText(noteMatch[1]) : null;

      const greenTickLine = ansText.split("\n").find((line) =>
        line.trim().match(/^\d+\.\s+\w/)
      );
      if (greenTickLine) {
        const tickMatch = greenTickLine.match(/^(\d+)\./);
        if (tickMatch) {
          const optNum = parseInt(tickMatch[1], 10);
          const ansMap: Record<number, string> = { 1: "A", 2: "B", 3: "C", 4: "D" };
          correctAnswer = ansMap[optNum] || null;
        }
      }

      if (!correctAnswer && optionA) {
        correctAnswer = "A";
      }

      questions.push({
        questionNumber,
        questionIdOriginal,
        questionText: questionText || `[Question ${questionNumber} - Image/Figure based]`,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer,
        chosenOption,
        status,
        hasFigure,
        note: note || null,
      });
    }
  }

  return questions;
}

function parse2025Format(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];

  const qBlocks = text.split(/(?=Q\.\d+)/);

  for (const block of qBlocks) {
    const qNumMatch = block.match(/^Q\.(\d+)/);
    if (!qNumMatch) continue;

    const questionNumber = parseInt(qNumMatch[1], 10);

    const ansIndex = block.indexOf("\nAns\n");
    const ansIndex2 = block.indexOf("\nAns ");
    const actualAnsIndex = ansIndex !== -1 ? ansIndex : ansIndex2;
    if (actualAnsIndex === -1) continue;

    const qNumStr = qNumMatch[0];
    let rawQuestionText = block.substring(qNumStr.length, actualAnsIndex);
    let questionText = cleanText(rawQuestionText);

    const hasFigure = questionText.length < 10 && !questionText.match(/[a-zA-Z]{3,}/);

    if (hasFigure || !questionText) {
      questionText = questionText || `[Question ${questionNumber} - Image/Figure based]`;
    }

    let optionA: string | null = null;
    let optionB: string | null = null;
    let optionC: string | null = null;
    let optionD: string | null = null;
    let correctAnswer: string | null = null;

    const ansSection = block.substring(actualAnsIndex);

    const optAMatch = ansSection.match(/\bA\.\s*(.*?)(?=\s*\bB\.|$)/s);
    const optBMatch = ansSection.match(/\bB\.\s*(.*?)(?=\s*\bC\.|$)/s);
    const optCMatch = ansSection.match(/\bC\.\s*(.*?)(?=\s*\bD\.|$)/s);
    const optDMatch = ansSection.match(/\bD\.\s*(.*?)$/s);

    if (optAMatch) optionA = cleanText(optAMatch[1]);
    if (optBMatch) optionB = cleanText(optBMatch[1]);
    if (optCMatch) optionC = cleanText(optCMatch[1]);
    if (optDMatch) optionD = cleanText(optDMatch[1]);

    const correctMarker = ansSection.match(/\b([A-D])\./);
    if (correctMarker) {
      correctAnswer = correctMarker[1];
    }

    questions.push({
      questionNumber,
      questionIdOriginal: null,
      questionText,
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer,
      chosenOption: null,
      status: null,
      hasFigure,
      note: null,
    });
  }

  return questions;
}

export async function parsePdfText(pdfBuffer: Buffer): Promise<ParseResult> {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js");

  const data = await pdfParse(pdfBuffer);
  const text = data.text;

  logger.info({ textLength: text.length }, "PDF text extracted");

  const format = detectFormat(text);
  logger.info({ format }, "Detected PDF format");

  let questions: ParsedQuestion[];

  if (format === "format_2016") {
    questions = parse2016Format(text);
  } else if (format === "format_2025") {
    questions = parse2025Format(text);
  } else {
    questions = parse2025Format(text);
    if (questions.length === 0) {
      questions = parse2016Format(text);
    }
  }

  logger.info({ questionsFound: questions.length }, "Questions parsed");

  return {
    questions,
    examName: extractExamName(text),
    detectedFormat: format,
  };
}

function extractExamName(text: string): string {
  const subjectMatch = text.match(/Subject\s*:?\s*(.*?)(?:\n|$)/i);
  if (subjectMatch) {
    return cleanText(subjectMatch[1]);
  }

  const rrbMatch = text.match(/(RRB\s+NTPC.*?)(?:\n|$)/i);
  if (rrbMatch) {
    return cleanText(rrbMatch[1]);
  }

  return "Unknown Exam";
}
