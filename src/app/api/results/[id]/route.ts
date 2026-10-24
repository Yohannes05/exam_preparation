import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { jsonify, parseJson } from "@/lib/serialize";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** GET /api/results/{id} — attempt with per-question breakdown. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();

    const attempt = await prisma.examAttempt.findUnique({
      where: { id: Number(params.id) },
      include: { exam: true, student: true },
    });
    if (!attempt) throw new ApiError(404, "Not found.");

    const questionIds = parseJson<number[]>(attempt.questionIds, []);
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
      include: { options: { orderBy: { label: "asc" } } },
    });
    const byId = new Map(questions.map((question) => [question.id, question]));

    const answers = parseJson<Record<string, { option: number; correct: boolean }>>(
      attempt.answers,
      {},
    );

    const breakdown = questionIds
      .map((questionId) => {
        const question = byId.get(questionId);
        if (!question) return null;
        const answer = answers[String(questionId)] ?? null;
        return {
          question: {
            id: question.id,
            question_text: question.questionText,
            explanation: question.explanation,
            difficulty: question.difficulty,
          },
          options: question.options,
          chosen_option_id: answer ? answer.option : null,
          is_correct: Boolean(answer?.correct),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return NextResponse.json({ attempt: jsonify(attempt), breakdown });
  } catch (error) {
    return errorResponse(error);
  }
}
