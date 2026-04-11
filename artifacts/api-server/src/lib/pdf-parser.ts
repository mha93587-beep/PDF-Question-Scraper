import { logger } from "./logger";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
  figureData: string | null;
  note: string | null;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  examName: string;
  detectedFormat: string;
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

/**
 * Detect fraction patterns spread across multiple lines and join them with "/".
 * e.g. "4sinA\n3" → "4sinA/3"
 * e.g. "(4+4cot²A)tanA\n(3+3tan²A)cosecA" → "(4+4cot²A)tanA / (3+3tan²A)cosecA"
 */
function reconstructFractions(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const curr = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();

    // Skip meta lines
    if (curr.match(/^(Note|Question\s*ID|Status|Chosen|Ans)\b/i)) {
      out.push(curr);
      i++;
      continue;
    }

    // Pattern 1: numerator line + pure-number denominator line → "num/denom"
    if (curr.length > 0 && /^\d{1,4}$/.test(next) && !next.match(/^[A-D]\s*[.)]/)) {
      out.push(`${curr}/${next}`);
      i += 2;
      continue;
    }

    // Pattern 2: two consecutive expression lines where neither is an option label →
    // treat as numerator/denominator of a larger fraction
    if (
      curr.length > 2 &&
      next.length > 2 &&
      !curr.match(/^\d{1,2}\.\s/) &&
      !next.match(/^\d{1,2}\.\s/) &&
      !curr.match(/^[A-D]\s*[.)]/) &&
      !next.match(/^[A-D]\s*[.)]/) &&
      curr.match(/[A-Za-z²³]/) &&
      next.match(/[A-Za-z²³]/) &&
      // both lines are short (likely fraction halves, not full sentences)
      curr.length < 60 &&
      next.length < 60
    ) {
      const afterNext = (lines[i + 2] ?? "").trim();
      // Only merge if the line after next is blank/option/meta (i.e. these two lines form a complete fraction)
      if (!afterNext || afterNext.match(/^[A-D\d]\s*[.)]/) || afterNext.match(/^(Ans|Note|Question)/i)) {
        out.push(`${curr} / ${next}`);
        i += 2;
        continue;
      }
    }

    out.push(curr);
    i++;
  }

  return out.filter((l) => l !== "").join("\n");
}

const execFileAsync = promisify(execFile);

interface PdfWord {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface PdfPage {
  number: number;
  width: number;
  height: number;
  words: PdfWord[];
}

interface QuestionVisual {
  dataUrl: string;
  ocrText: string;
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseBboxPages(html: string): PdfPage[] {
  const pages: PdfPage[] = [];
  const pageRegex = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)(?=<page width=|<\/doc>)/g;
  let pageMatch: RegExpExecArray | null;
  let pageNumber = 1;

  while ((pageMatch = pageRegex.exec(html)) !== null) {
    const words: PdfWord[] = [];
    const wordRegex = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
    let wordMatch: RegExpExecArray | null;

    while ((wordMatch = wordRegex.exec(pageMatch[3])) !== null) {
      words.push({
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
        text: decodeHtmlEntity(wordMatch[5]).trim(),
      });
    }

    pages.push({
      number: pageNumber,
      width: Number(pageMatch[1]),
      height: Number(pageMatch[2]),
      words,
    });
    pageNumber += 1;
  }

  return pages;
}

function extract2016QuestionNumber(block: string): number | null {
  const splitNumberMatch = block.match(/Q\.\s*(\d+)\s*\n\s*(\d+)\s+Question ID/);
  if (splitNumberMatch) {
    return Number(`${splitNumberMatch[1]}${splitNumberMatch[2]}`);
  }

  const qNumMatch = block.match(/Q\.(\d+)/);
  if (qNumMatch) {
    return Number(qNumMatch[1]);
  }

  const subQuestionMatch = block.match(/SubQuestion No\s*:\s*(\d+)/);
  return subQuestionMatch ? Number(subQuestionMatch[1]) : null;
}

function runBinary(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "buffer", maxBuffer: 30 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || "");
        reject(new Error(`${command} failed: ${detail || error.message}`));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

async function extractTextWithPdftotext(pdfPath: string): Promise<string> {
  const outputPath = `${pdfPath}.txt`;
  await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, outputPath], {
    maxBuffer: 30 * 1024 * 1024,
  });
  return readFile(outputPath, "utf8");
}

async function ocrImage(imagePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "tesseract",
      [imagePath, "stdout", "--oem", "1", "--psm", "6", "-c", "preserve_interword_spaces=1"],
      { maxBuffer: 5 * 1024 * 1024 }
    );
    return typeof stdout === "string" ? stdout : String(stdout);
  } catch {
    try {
      // fallback to default psm if LSTM fails
      const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "--psm", "4"], {
        maxBuffer: 5 * 1024 * 1024,
      });
      return typeof stdout === "string" ? stdout : String(stdout);
    } catch (err) {
      logger.warn({ err }, "OCR failed for PDF question crop");
      return "";
    }
  }
}

async function renderQuestionVisual(
  tempDir: string,
  pdfPath: string,
  page: PdfPage,
  yStart: number,
  yEnd: number,
  renderedPages: Map<number, string>,
): Promise<QuestionVisual | null> {
  const renderPrefix = path.join(tempDir, `page-${page.number}`);
  let renderedPath = renderedPages.get(page.number);
  if (!renderedPath) {
    await execFileAsync("pdftoppm", ["-png", "-r", "260", "-f", String(page.number), "-l", String(page.number), pdfPath, renderPrefix], {
      maxBuffer: 30 * 1024 * 1024,
    });
    renderedPath = `${renderPrefix}-${String(page.number).padStart(2, "0")}.png`;
    renderedPages.set(page.number, renderedPath);
  }
  const scale = 260 / 72;
  const margin = 8;
  const y = Math.max(0, Math.floor((yStart - margin) * scale));
  const height = Math.max(40, Math.floor((Math.min(page.height, yEnd + margin) - Math.max(0, yStart - margin)) * scale));
  const width = Math.floor(page.width * scale);
  const cropPath = path.join(tempDir, `question-${page.number}-${Math.round(yStart)}.jpg`);

  try {
    await execFileAsync("convert", [
      renderedPath,
      "-crop",
      `${width}x${height}+0+${y}`,
      "+repage",
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-colorspace",
      "Gray",
      "-level",
      "5%,78%",
      "-sharpen",
      "0x1",
      cropPath,
    ]);

    const ocrText = await ocrImage(cropPath);
    const jpg = await runBinary("convert", [
      cropPath,
      "-strip",
      "-resize",
      "900x>",
      "-quality",
      "82",
      "jpg:-",
    ]);

    if (jpg.length < 500) {
      return null;
    }

    return {
      dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}`,
      ocrText,
    };
  } catch (err) {
    logger.warn({ err, page: page.number }, "Failed to crop PDF question image");
    return null;
  }
}

async function extractQuestionVisuals(pdfPath: string, tempDir: string): Promise<Map<number, QuestionVisual>> {
  const bboxPath = path.join(tempDir, "bbox.html");
  await execFileAsync("pdftotext", ["-bbox-layout", pdfPath, bboxPath], {
    maxBuffer: 30 * 1024 * 1024,
  });
  const html = await readFile(bboxPath, "utf8");
  const pages = parseBboxPages(html);
  const anchors = pages.flatMap((page) => {
    const pageAnchors: { questionNumber: number; page: PdfPage; word: PdfWord }[] = [];

    for (let index = 0; index < page.words.length; index += 1) {
      const word = page.words[index];
      const match = word.text.match(/^Q\.(\d+)$/);
      if (!match) continue;

      const nextWord = page.words[index + 1];
      const baseNumber = match[1];
      const joinedNumber =
        nextWord?.text.match(/^\d{1,2}$/) &&
        nextWord.xMin < 100 &&
        nextWord.yMin - word.yMin < 25
          ? Number(`${baseNumber}${nextWord.text}`)
          : Number(baseNumber);

      pageAnchors.push({ questionNumber: joinedNumber, page, word });
    }

    return pageAnchors;
  });
  const visuals = new Map<number, QuestionVisual>();
  const renderedPages = new Map<number, string>();

  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index];
    const next = anchors[index + 1];
    const yEnd = next?.page.number === current.page.number ? Math.max(current.word.yMax + 45, next.word.yMin - 5) : current.page.height - 20;
    const visual = await renderQuestionVisual(tempDir, pdfPath, current.page, current.word.yMin, yEnd, renderedPages);
    if (visual) {
      visuals.set(current.questionNumber, visual);
    }
  }

  return visuals;
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

function normalizeOcrText(text: string): string {
  return text
    .replace(/[|]+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanOcrValue(value: string): string {
  return cleanText(
    value
      .replace(/Question\s*ID\s*:?\s*\d+.*/gi, "")
      .replace(/Status\s*:?\s*\w+.*/gi, "")
      .replace(/Chosen\s*Option\s*:?\s*\d+.*/gi, "")
      .replace(/\bAns\b[\s\S]*$/i, "")
      .replace(/Adda\s*247/gi, "")
      .replace(/[✓✔✗×]\s*\d+\s*[A-D0]?\b/gi, "")
  );
}

function extractOptionFromOcr(text: string, label: "A" | "B" | "C" | "D"): string | null {
  const reconstructed = reconstructFractions(text);
  const nextLabels = label === "A" ? "B" : label === "B" ? "C" : label === "C" ? "D" : "Ans|$";
  const pattern = label === "D"
    ? new RegExp(`(?:^|\\n)\\s*${label}\\s*[.)]\\s*([\\s\\S]*?)(?=\\n\\s*(?:Ans|Question\\s*ID|Status|Chosen\\s*Option)\\b|$)`, "i")
    : new RegExp(`(?:^|\\n)\\s*${label}\\s*[.)]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${nextLabels})\\s*[.)]|\\n\\s*Ans\\b|$)`, "i");
  const match = reconstructed.match(pattern);
  const cleaned = match ? cleanOcrValue(match[1]) : "";
  return cleaned || null;
}

function extractQuestionTextFromOcr(text: string, questionNumber: number): string | null {
  const normalized = normalizeOcrText(text);
  const beforeOptions = normalized.split(/\n\s*A\s*[.)]/i)[0] || normalized;
  const withoutMeta = beforeOptions
    .replace(new RegExp(`^\\s*Q\\.?\\s*${questionNumber}\\s*`, "i"), "")
    .replace(/^Q\s*\d+\s*/i, "");
  const cleaned = cleanOcrValue(withoutMeta);
  return cleaned.length > 3 ? cleaned : null;
}

function ocrHasUsableText(text: string): boolean {
  const cleaned = cleanOcrValue(normalizeOcrText(text));
  const wordCount = (cleaned.match(/[A-Za-z0-9₹]+/g) || []).length;
  // Also accept math-heavy content (formulas, equations)
  const mathSymbols = (cleaned.match(/[+\-×÷=²³√π°%()]/g) || []).length;
  return wordCount >= 8 || (wordCount >= 4 && mathSymbols >= 2);
}

function shouldKeepFigureImage(questionText: string, visual: QuestionVisual | null): boolean {
  if (!visual) return false;

  const combinedText = `${questionText} ${visual.ocrText}`.toLowerCase();
  const figureKeywords = [
    // Visual/spatial
    "figure", "diagram", "image", "photo", "picture", "shown", "given below",
    "following", "mirror", "water image", "embedded", "paper folding",
    "cube", "dice", "venn", "pattern", "आकृति", "चित्र",
    // Charts & data
    "bar chart", "pie chart", "bar graph", "pie graph", "histogram",
    "table", "chart", "graph",
    // Math visuals (fractions, equations that need layout)
    "simplify", "solve", "calculate", "evaluate",
    "sin", "cos", "tan", "cot", "sec", "cosec", "cot²", "tan²", "sin²", "cos²",
    "trigonometric", "trigonometry",
    "√", "∛", "²", "³", "∑", "∫",
    // Reasoning visuals
    "series", "analogy", "matrix", "missing", "next term",
  ];

  if (figureKeywords.some((keyword) => combinedText.includes(keyword))) {
    return true;
  }

  return !ocrHasUsableText(visual.ocrText) && cleanText(questionText).length < 20;
}

function parse2016Format(text: string, visualsByQuestion: Map<number, QuestionVisual>): ParsedQuestion[] {
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
        questionText = cleanText(reconstructFractions(mainTextMatch[1]));
      }
    }

    const visual = visualsByQuestion.get(questionNumber) || null;
    const ocrQuestionText = visual ? extractQuestionTextFromOcr(visual.ocrText, questionNumber) : null;
    // Use OCR text when pdftotext gives garbage: very short, no real words, only digits, or looks like a QID
    const looksLikeGarbage = questionText.length < 15 || !questionText.match(/[a-zA-Z]{3,}/) || /^\d{3,6}$/.test(questionText.trim());
    if (ocrQuestionText && looksLikeGarbage) {
      questionText = ocrQuestionText;
    }

    let optionA: string | null = null;
    let optionB: string | null = null;
    let optionC: string | null = null;
    let optionD: string | null = null;
    let correctAnswer: string | null = null;

    const ansSection = block.match(/Ans\s+([\s\S]*?)$/);
    if (ansSection) {
      const ansText = reconstructFractions(ansSection[1]);

      const opt1Match = ansText.match(/1\.\s*(.*?)(?=\s*2\.|$)/s);
      const opt2Match = ansText.match(/2\.\s*(.*?)(?=\s*3\.|$)/s);
      const opt3Match = ansText.match(/3\.\s*(.*?)(?=\s*4\.|$)/s);
      const opt4Match = ansText.match(/4\.\s*(.*?)(?=\s*Note:|$)/s);

      if (opt1Match) optionA = cleanText(opt1Match[1]);
      if (opt2Match) optionB = cleanText(opt2Match[1]);
      if (opt3Match) optionC = cleanText(opt3Match[1]);
      if (opt4Match) optionD = cleanText(opt4Match[1]);

      if (visual) {
        optionA = extractOptionFromOcr(visual.ocrText, "A") || optionA;
        optionB = extractOptionFromOcr(visual.ocrText, "B") || optionB;
        optionC = extractOptionFromOcr(visual.ocrText, "C") || optionC;
        optionD = extractOptionFromOcr(visual.ocrText, "D") || optionD;
      }

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

      const keepFigure = shouldKeepFigureImage(questionText, visual);

      questions.push({
        questionNumber,
        questionIdOriginal,
        questionText: questionText || ocrQuestionText || `[Question ${questionNumber} - Image/Figure based]`,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer,
        chosenOption,
        status,
        hasFigure: keepFigure,
        figureData: keepFigure && visual ? visual.dataUrl : null,
        note: note || null,
      });
    }
  }

  return questions;
}

function parse2025Format(text: string, visualsByQuestion: Map<number, QuestionVisual>): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];

  const qBlocks = text.match(/(?:^|\n)\s*Q\.\d+\b[\s\S]*?(?=\n\s*Q\.\d+\b|$)/g) || [];

  for (const block of qBlocks) {
    const qNumMatch = block.match(/^\s*Q\.(\d+)/);
    if (!qNumMatch) continue;

    const questionNumber = parseInt(qNumMatch[1], 10);

    const ansMatch = block.match(/\n\s*Ans\b/);
    const actualAnsIndex = ansMatch?.index ?? -1;
    if (actualAnsIndex === -1) continue;

    const qNumStr = qNumMatch[0];
    let rawQuestionText = block.substring(qNumStr.length, actualAnsIndex);
    let questionText = cleanText(rawQuestionText);

    const visual = visualsByQuestion.get(questionNumber) || null;
    const hasFigure = shouldKeepFigureImage(questionText, visual);

    if (hasFigure || !questionText) {
      questionText = questionText || `[Question ${questionNumber} - Image/Figure based]`;
    }

    let optionA: string | null = null;
    let optionB: string | null = null;
    let optionC: string | null = null;
    let optionD: string | null = null;
    let correctAnswer: string | null = null;

    const ansSection = reconstructFractions(block.substring(actualAnsIndex));

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
      figureData: hasFigure && visual ? visual.dataUrl : null,
      note: null,
    });
  }

  return questions;
}

export async function parsePdfText(pdfBuffer: Buffer): Promise<ParseResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "question-bank-pdf-"));
  const pdfPath = path.join(tempDir, "paper.pdf");

  try {
    await writeFile(pdfPath, pdfBuffer);

    let text = "";
    try {
      text = await extractTextWithPdftotext(pdfPath);
    } catch (err) {
      logger.warn({ err }, "pdftotext extraction failed, falling back to pdf-parse");
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);
      const pdfParse = require("pdf-parse/lib/pdf-parse.js");
      const data = await pdfParse(pdfBuffer);
      text = data.text;
    }

    logger.info({ textLength: text.length }, "PDF text extracted");

    let visualsByQuestion = new Map<number, QuestionVisual>();
    try {
      visualsByQuestion = await extractQuestionVisuals(pdfPath, tempDir);
    } catch (err) {
      logger.warn({ err }, "PDF question image extraction failed");
    }

    const format = detectFormat(text);
    logger.info({ format }, "Detected PDF format");

    let questions: ParsedQuestion[];

    if (format === "format_2016") {
      questions = parse2016Format(text, visualsByQuestion);
    } else if (format === "format_2025") {
      questions = parse2025Format(text, visualsByQuestion);
    } else {
      questions = parse2025Format(text, visualsByQuestion);
      if (questions.length === 0) {
        questions = parse2016Format(text, visualsByQuestion);
      }
    }

    logger.info({ questionsFound: questions.length, questionImagesFound: questions.filter((q) => q.figureData).length, ocrCropsProcessed: visualsByQuestion.size }, "Questions parsed");

    return {
      questions,
      examName: extractExamName(text),
      detectedFormat: format,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
