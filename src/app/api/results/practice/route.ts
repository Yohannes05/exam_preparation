import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { getPage, paginateResponse } from "@/lib/paginate";
import { jsonify } from "@/lib/serialize";

/** GET /api/results/practice — individual answers to practice questions. */
export async function GET(request: Request) {
  try {
    await requireAdmin();

    const page = getPage(request);
    const [rows, total] = await Promise.all([
      prisma.questionAttempt.findMany({
        where: { examAttemptId: null },
        include: {
          student: { include: { grade: true } },
          question: { include: { chapter: true, subject: true, options: { orderBy: { label: "asc" } } } },
          chosenOption: true,
        },
        orderBy: { answeredAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      prisma.questionAttempt.count({ where: { examAttemptId: null } }),
    ]);

    return NextResponse.json(paginateResponse(request, jsonify(rows), total));
  } catch (error) {
    return errorResponse(error);
  }
}
