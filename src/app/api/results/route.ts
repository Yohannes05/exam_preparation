import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { getPage, paginateResponse } from "@/lib/paginate";
import { jsonify } from "@/lib/serialize";

/** GET /api/results — completed exam attempts with filters. */
export async function GET(request: Request) {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const page = getPage(request);
    const examId = url.searchParams.get("exam_id");
    const studentId = url.searchParams.get("student_id");
    const type = url.searchParams.get("type");

    const where = {
      status: "completed" as const,
      ...(examId ? { examId: Number(examId) } : {}),
      ...(studentId ? { studentId: Number(studentId) } : {}),
      ...(type ? { exam: { type } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.examAttempt.findMany({
        where,
        include: { exam: { include: { grade: true, subject: true } }, student: true },
        orderBy: { completedAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      prisma.examAttempt.count({ where }),
    ]);

    return NextResponse.json(paginateResponse(request, jsonify(rows), total));
  } catch (error) {
    return errorResponse(error);
  }
}
