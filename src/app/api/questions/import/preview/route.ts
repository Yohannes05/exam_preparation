import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { createHash } from "node:crypto";
import { isUploadedFile } from "@/lib/uploaded-file";

export const dynamic = "force-dynamic";

const IMPORT_TTL_MS = 30 * 60 * 1000;
const IMPORT_MAX_ROWS = 1000;

/** Normalized header aliases (Laravel QuestionImportController::columnMap). */
const ALIASES: Record<string, string[]> = {
  question: ["q", "question", "questiontext"],
  A: ["a", "optiona", "choicea", "answera"],
  B: ["b", "optionb", "choiceb", "answerb"],
  C: ["c", "optionc", "choicec", "answerc"],
  D: ["d", "optiond", "choiced", "answerd"],
  answer: ["ans", "answer", "correct", "correctanswer"],
  chapter: ["chap", "chapter", "chapternumber", "unit", "unitnumber"],
  explanation: ["why", "explanation", "solution"],
  source: ["source", "origin"],
  year: ["year", "yearec", "ecyear"],
};

type Matrix = string[][];
type ImportedRow = {
  row: number;
  question_text: string;
  options: Array<{ label: string; text: string; is_correct: boolean }>;
  correct_answer: string | null;
  chapter_number: string;
  chapter_id: number | null;
  explanation: string;
  source: string | null;
  year: number | null;
  duplicate: boolean;
  errors: string[];
  ready: boolean;
};

/** POST /api/questions/import/preview — parse CSV/XLSX and stage validated rows. */
export async function POST(request: Request) {
  try {
    await requireAdmin();

    const form = await request.formData();
    const file = form.get("file");
    const gradeId = Number(form.get("grade_id") ?? "");
    const subjectId = Number(form.get("subject_id") ?? "");
    const sourceInput = String(form.get("source") ?? "");
    const yearInput = String(form.get("year") ?? "");

    const errors: Record<string, string[]> = {};
    if (!isUploadedFile(file)) errors.file = ["The file field is required."];
    if (isUploadedFile(file) && file.size > 10 * 1024 * 1024) {
      errors.file = ["The file may not be greater than 10 MB."];
    }
    if (!Number.isInteger(gradeId) || gradeId <= 0) errors.grade_id = ["The grade id field is required."];
    if (!Number.isInteger(subjectId) || subjectId <= 0) errors.subject_id = ["The subject id field is required."];
    if (Object.keys(errors).length) throw new ApiError(422, "The given data was invalid.", errors);

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new ApiError(404, "Subject not found.");
    if (subject.gradeId !== gradeId) {
      throw new ApiError(422, "Choose a subject that belongs to the selected grade.");
    }

    if (!isUploadedFile(file)) throw new ApiError(422, "The file field is required.");
    const name = file.name.toLowerCase();
    const extension = name.split(".").pop() ?? "";
    if (!["csv", "txt", "xlsx"].includes(extension)) {
      throw new ApiError(422, "Upload a CSV file or an Excel .xlsx file.");
    }

    const matrix =
      extension === "xlsx"
        ? await readXlsx(await file.arrayBuffer())
        : readCsv(await file.text());
    if (matrix.length < 2) {
      throw new ApiError(422, "The file needs a header row and at least one question.");
    }
    if (matrix.length > IMPORT_MAX_ROWS + 1) {
      throw new ApiError(422, "Import up to 1,000 question rows at a time.");
    }

    const headers = matrix[0].map(normalizeHeader);
    const columns = columnMap(headers);
    const choiceKeys = ["A", "B", "C", "D"] as const;
    const presentChoices = choiceKeys.filter((key) => columns[key] !== undefined);
    if (columns.question === undefined || columns.answer === undefined || presentChoices.length < 2) {
      throw new ApiError(422, "Include Question, at least two choices (A–D), and Answer columns.");
    }

    const seen = new Set<string>();
    const rows: ImportedRow[] = [];

    for (let index = 1; index < matrix.length; index++) {
      const cells = matrix[index];
      if (cells.every((value) => value.trim() === "")) continue;

      const get = (key: string) => (columns[key] !== undefined ? (cells[columns[key]] ?? "").trim() : "");

      const questionText = get("question");
      const choiceTexts: Array<[string, string]> = choiceKeys
        .map((key) => [key, get(key)] as [string, string])
        .filter(([, text]) => text !== "");
      const answer = get("answer").toUpperCase();
      let correctLabel: string | null = null;
      for (const [label, text] of choiceTexts) {
        if (answer === label || answer.toLowerCase() === text.toLowerCase()) {
          correctLabel = label;
          break;
        }
      }

      const rowErrors: string[] = [];
      if (questionText === "") rowErrors.push("Question text is empty.");
      if (choiceTexts.length < 2) rowErrors.push("Add at least two answer choices.");
      if (correctLabel === null) {
        rowErrors.push("Answer must match A, B, C, D, or the exact choice text.");
      }

      const chapterNumber = get("chapter");
      let chapter: { id: number } | null = null;
      if (chapterNumber !== "" && /^\d+$/.test(chapterNumber)) {
        chapter = await prisma.chapter.findFirst({
          where: { subjectId: subject.id, order: Number(chapterNumber) },
          select: { id: true },
        });
      }
      if (chapterNumber === "" || !chapter) {
        rowErrors.push("Chapter number is missing or does not exist for this subject.");
      }

      const yearText = get("year");
      const rowYear = yearText !== "" ? yearText : yearInput !== "" ? yearInput : null;
      if (rowYear !== null && (!/^\d+$/.test(rowYear) || Number(rowYear) < 1900 || Number(rowYear) > 2100)) {
        rowErrors.push("Year must be between 1900 and 2100 E.C.");
      }

      const fingerprint = createHash("sha256")
        .update(`${chapter?.id ?? "none"}:${questionText.trim().toLowerCase()}`)
        .digest("hex");
      let duplicate = seen.has(fingerprint);
      seen.add(fingerprint);
      if (!duplicate && chapter && questionText !== "") {
        duplicate = await prisma.question.findFirst({
          where: {
            gradeId,
            subjectId: subject.id,
            chapterId: chapter.id,
            questionText,
          },
          select: { id: true },
        }).then((row) => row !== null);
      }

      rows.push({
        row: index + 1,
        question_text: questionText,
        options: choiceTexts.map(([label, text]) => ({
          label,
          text,
          is_correct: label === correctLabel,
        })),
        correct_answer: correctLabel,
        chapter_number: chapterNumber,
        chapter_id: chapter?.id ?? null,
        explanation: get("explanation"),
        source: get("source") || (sourceInput !== "" ? sourceInput : null),
        year: rowYear !== null ? Number(rowYear) : null,
        duplicate,
        errors: rowErrors,
        ready: rowErrors.length === 0 && !duplicate,
      });
    }

    if (rows.length === 0) {
      throw new ApiError(422, "No question rows were found under the header.");
    }

    const preview = await prisma.importPreview.create({
      data: {
        data: JSON.stringify({ grade_id: gradeId, subject_id: subject.id, rows }),
        expiresAt: new Date(Date.now() + IMPORT_TTL_MS),
      },
      select: { id: true },
    });
    // Purge expired stagings opportunistically.
    await prisma.importPreview.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    return NextResponse.json({
      preview_key: preview.id,
      rows,
      total: rows.length,
      ready: rows.filter((row) => row.ready).length,
      duplicates: rows.filter((row) => row.duplicate).length,
      needs_fix: rows.filter((row) => row.errors.length > 0).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/gi, "");
}

function columnMap(headers: string[]): Record<string, number> {
  const columns: Record<string, number> = {};
  headers.forEach((header, index) => {
    for (const [key, names] of Object.entries(ALIASES)) {
      if (names.includes(header) && columns[key] === undefined) columns[key] = index;
    }
  });
  return columns;
}

/** Parse CSV text with a sniffed delimiter (, ; or tab). */
function readCsv(text: string): Matrix {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((separator) => ({
    separator,
    count: (firstLine.match(new RegExp(escapeRegExp(separator), "g")) ?? []).length,
  }));
  const delimiter = counts.sort((a, b) => b.count - a.count)[0]?.separator ?? ",";

  const bomless = text.replace(/^\uFEFF/, "");
  return parseWithDelimiter(bomless, delimiter);
}

/** RFC-4180-style field splitting for a known delimiter. */
function parseWithDelimiter(stripped: string, delimiter: string): Matrix {
  const rows: Matrix = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i];
    if (inQuotes) {
      if (char === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && stripped[i + 1] === "\n") i++;
      row.push(field.trim());
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 1 || row[0] !== "") {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse xlsx sheet1 via the optional `xlsx` package (spreadsheetml). */
async function readXlsx(bytes: ArrayBuffer): Promise<Matrix> {
  let XLSX: typeof import("xlsx") | null = null;
  try {
    XLSX = (await import(/* webpackMode: "eager" */ "xlsx")) as typeof import("xlsx");
  } catch {
    XLSX = null;
  }
  if (!XLSX) {
    throw new ApiError(422, "This server cannot read .xlsx files. Save the spreadsheet as CSV and upload it again.");
  }

  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new ApiError(422, "The Excel file has no readable first worksheet.");

  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  return matrix.map((cells) => (Array.isArray(cells) ? cells.map((value) => String(value ?? "").trim()) : []));
}
