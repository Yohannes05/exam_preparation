import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { getPage, paginateResponse } from "@/lib/paginate";
import { jsonify } from "@/lib/serialize";

/** GET /api/students — list with grade and accuracy aggregates. */
export async function GET(request: Request) {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const page = getPage(request);
    const search = url.searchParams.get("search");
    const gradeId = url.searchParams.get("grade_id");

    const where = {
      ...(search
        ? {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
              { telegramUsername: { contains: search } },
            ],
          }
        : {}),
      ...(gradeId ? { gradeId: Number(gradeId) } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          grade: true,
          _count: { select: { questionAttempts: true, referralsGiven: true } },
        },
        orderBy: { id: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      prisma.student.count({ where }),
    ]);

    // Attach accuracy per student.
    const ids = rows.map((student) => student.id);
    const [answeredCounts, correctCounts, qualifiedReferralCounts] = await Promise.all([
      prisma.questionAttempt.groupBy({
        by: ["studentId"],
        where: { studentId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.questionAttempt.groupBy({
        by: ["studentId"],
        where: { studentId: { in: ids }, isCorrect: true },
        _count: { _all: true },
      }),
      prisma.referral.groupBy({
        by: ["referrerStudentId"],
        where: { referrerStudentId: { in: ids }, qualifiedAt: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const answeredById = new Map(answeredCounts.map((row) => [row.studentId, row._count._all]));
    const correctById = new Map(correctCounts.map((row) => [row.studentId, row._count._all]));
    const qualifiedReferralsById = new Map(qualifiedReferralCounts.map((row) => [row.referrerStudentId, row._count._all]));

    const data = rows.map((student) => {
      const answered = answeredById.get(student.id) ?? 0;
      const correct = correctById.get(student.id) ?? 0;
      return {
        ...jsonify(student),
        answered,
        accuracy: answered > 0 ? Math.round((correct / answered) * 1000) / 10 : null,
        qualified_referrals: qualifiedReferralsById.get(student.id) ?? 0,
      };
    });

    return NextResponse.json(paginateResponse(request, data, total));
  } catch (error) {
    return errorResponse(error);
  }
}
