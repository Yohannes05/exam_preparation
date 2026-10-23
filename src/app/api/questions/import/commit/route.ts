import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";

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

/** POST /api/questions/import/commit — insert staged ready rows. */
export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => ({}))) as { preview_key?: unknown };
    const previewKey = typeof body.preview_key === "string" ? body.preview_key : "";
    if (!/^[0-9a-f-]{36}$/i.test(previewKey)) {
      throw new ApiError(422, "The given data was invalid.", {
        preview_key: ["The preview key must be a valid UUID."],
      });
    }

    const staged = await prisma.importPreview.findUnique({ where: { id: previewKey } });
    if (!staged || staged.expiresAt.getTime() < Date.now()) {
      throw new ApiError(404, "This import preview expired. Upload the file again.");
    }

    const parsed = JSON.parse(staged.data) as {
      grade_id: number;
      subject_id: number;
      rows: ImportedRow[];
    };
    const readyRows = parsed.rows.filter((row) => row.ready);
    if (readyRows.length === 0) {
      throw new ApiError(422, "There are no valid new questions to import.");
    }

    let imported = 0;
    let skipped = parsed.rows.length - readyRows.length;

    await prisma.$transaction(async (tx) => {
      for (const row of readyRows) {
        const exists = await tx.question.findFirst({
          where: {
            gradeId: parsed.grade_id,
            subjectId: parsed.subject_id,
            chapterId: row.chapter_id ?? undefined,
            questionText: row.question_text,
          },
          select: { id: true },
        });
        if (exists) {
          skipped += 1;
          continue;
        }

        const question = await tx.question.create({
          data: {
            gradeId: parsed.grade_id,
            subjectId: parsed.subject_id,
            chapterId: row.chapter_id as number,
            questionText: row.question_text,
            questionType: "multiple_choice",
            difficulty: "medium",
            explanation: row.explanation || null,
            source: row.source,
            year: row.year,
            isActive: true,
          },
        });
        await tx.questionOption.createMany({
          data: row.options.map((option) => ({
            questionId: question.id,
            label: option.label,
            text: option.text,
            isCorrect: option.is_correct,
          })),
        });
        imported += 1;
      }
    });

    await prisma.importPreview.delete({ where: { id: previewKey } });

    return NextResponse.json({ imported, skipped });
  } catch (error) {
    return errorResponse(error);
  }
}
