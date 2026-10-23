import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { jsonify } from "@/lib/serialize";
import { TelegramClient, log as telegramLog } from "@/lib/telegram";

const schema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  audience: z.enum(["all", "grade", "activated"]),
  grade_id: z.coerce.number().int().nullish(),
  send_as_message: z.boolean().optional(),
});

/** POST /api/announcements/publish — broadcast an announcement (optional message fan-out). */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(422, "The given data was invalid.");
    }
    const data = parsed.data;

    let gradeError: string | null = null;
    if (data.audience === "grade" && !data.grade_id) {
      gradeError = "The grade id field is required when audience is grade.";
    } else if (data.audience !== "grade" && data.grade_id != null) {
      gradeError = "The grade id field is reserved for grade audiences.";
    }
    if (gradeError) {
      throw new ApiError(422, "The given data was invalid.", { grade_id: [gradeError] });
    }

    const telegram = new TelegramClient();
    if (data.send_as_message && telegram.mock()) {
      throw new ApiError(
        422,
        "Configure TELEGRAM_BOT_TOKEN before sending announcements to students.",
      );
    }

    const announcement = await prisma.announcement.create({
      data: {
        title: data.title,
        body: data.body,
        audience: data.audience,
        gradeId: data.audience === "grade" ? data.grade_id : null,
        isPublished: true,
        publishedAt: new Date(),
        createdBy: admin.sub,
      },
      include: { grade: true },
    });

    let sent = 0;
    let failed = 0;
    if (data.send_as_message) {
      const students = await prisma.student.findMany({
        where: {
          isActive: true,
          ...(data.audience === "grade" ? { gradeId: data.grade_id } : {}),
          ...(data.audience === "activated" ? { activatedUntil: { gt: new Date() } } : {}),
        },
        select: { id: true, telegramId: true },
      });

      for (const student of students) {
        const failedBefore = telegramLog.failed.length;
        await telegram.sendMessage(
          Number(student.telegramId),
          `📢 <b>${escapeHtml(announcement.title)}</b>\n\n${escapeHtml(announcement.body)}`,
        );
        if (telegramLog.failed.length > failedBefore) failed += 1;
        else sent += 1;
      }
    }

    return NextResponse.json(
      {
        announcement: jsonify(announcement),
        messages_sent: sent,
        messages_failed: failed,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
