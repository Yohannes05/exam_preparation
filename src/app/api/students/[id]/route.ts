import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { jsonify } from "@/lib/serialize";
import { forStudent, mistakes as listMistakes } from "@/lib/progress";
import { TelegramClient } from "@/lib/telegram";
import { formatAddis } from "@/lib/time";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

async function findStudent(id: number) {
  const student = await prisma.student.findUnique({ where: { id }, include: { grade: true } });
  if (!student) throw new ApiError(404, "Not found.");
  return student;
}

/** GET /api/students/{id} — profile plus full progress breakdown. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const student = await findStudent(Number(params.id));

    const [progress, mistakeRows, attemptRows] = await Promise.all([
      forStudent(prisma, student),
      listMistakes(prisma, student.id, 20),
      prisma.examAttempt.findMany({
        where: { studentId: student.id },
        include: { exam: true },
        orderBy: { id: "desc" },
        take: 20,
      }),
    ]);

    return NextResponse.json({
      student: jsonify(student),
      progress,
      mistakes: jsonify(mistakeRows),
      attempts: jsonify(attemptRows),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const updateSchema = z.object({
  grade_id: z.coerce.number().int().nullish(),
  stream: z.enum(["natural", "social"]).nullish(),
  is_active: z.boolean().optional(),
  activate_for_days: z.coerce.number().int().nullish(),
  revoke_activation: z.boolean().nullish(),
});

/** PATCH /api/students/{id} — admin edit (activate, change grade). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const admin = await requireAdmin();
    void admin;
    const student = await findStudent(Number(params.id));

    const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new ApiError(422, "The given data was invalid.");
    const input = parsed.data;

    const data: { gradeId?: number | null; stream?: string | null; isActive?: boolean; activatedUntil?: Date | null } = {};
    if (input.grade_id !== undefined) {
      data.gradeId = input.grade_id === null ? null : input.grade_id;
      const targetGrade = input.grade_id == null ? null : await prisma.grade.findUnique({ where: { id: input.grade_id }, select: { level: true } });
      if (targetGrade?.level !== 12) data.stream = null;
    }
    if (input.stream !== undefined) {
      const gradeId = input.grade_id === undefined ? student.gradeId : input.grade_id;
      const targetGrade = gradeId == null ? null : await prisma.grade.findUnique({ where: { id: gradeId }, select: { level: true } });
      if (targetGrade?.level !== 12 && input.stream != null) throw new ApiError(422, "Streams can only be assigned to Grade 12 students.");
      data.stream = input.stream ?? null;
    }
    if (input.is_active !== undefined) data.isActive = input.is_active;

    if (input.revoke_activation === true) {
      data.activatedUntil = null;
    } else if (input.activate_for_days != null) {
      if (input.activate_for_days !== 30) {
        throw new ApiError(422, "activate_for_days must be 30.");
      }
      const startsAt =
        student.activatedUntil && student.activatedUntil.getTime() > Date.now()
          ? student.activatedUntil
          : new Date();
      data.activatedUntil = new Date(startsAt.getTime() + input.activate_for_days * 86_400_000);
    }

    const updated = await prisma.student.update({
      where: { id: student.id },
      data,
      include: { grade: true },
    });

    if (data.activatedUntil !== undefined) {
      const telegram = new TelegramClient();
      const message = updated.activatedUntil
        ? `✅ Your account is active until <b>${formatAddis(updated.activatedUntil)}</b>. You can now use unlimited questions.`
        : "Your account activation has ended. Free access is still available.";
      await telegram.sendMessage(Number(updated.telegramId), message);
    }

    return NextResponse.json(jsonify(updated));
  } catch (error) {
    return errorResponse(error);
  }
}
