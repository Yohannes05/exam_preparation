import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireCronSecret } from "@/lib/auth";
import { TelegramClient } from "@/lib/telegram";
import { formatAddis } from "@/lib/time";
import { jsonify } from "@/lib/serialize";

/**
 * GET /api/cron/remind-expiring — port of telegram:remind-expiring-activations.
 *
 * Reminds students whose paid activation ends in three days (Addis Ababa days).
 */
export async function GET(request: Request) {
  try {
    requireCronSecret(request);

    // Start of the day three days from now, in Addis time (UTC+3).
    const dayStart = new Date(addisDayStartUtc().getTime() + 3 * 86_400_000);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);

    const students = await prisma.student.findMany({
      where: {
        activatedUntil: { gte: dayStart, lte: dayEnd },
        isActive: true,
      },
      orderBy: { id: "asc" },
      take: 500,
    });

    const telegram = new TelegramClient();
    for (const student of students) {
      await telegram.sendMessage(
        Number(student.telegramId),
        student.activatedUntil
          ? `⏳ Your activation ends in 3 days (${formatAddis(student.activatedUntil)}). Open To Activate to renew and keep unlimited access.`
          : "⏳ Your activation ends in 3 days. Open To Activate to renew and keep unlimited access.",
        [[{ text: "💰 To Activate", callback_data: "activate" }]],
      );
    }

    return NextResponse.json({ reminded: students.length, students: jsonify(students.map((s) => ({ id: s.id }))) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Midnight of the current Addis Ababa day, as a UTC instant. */
function addisDayStartUtc(): Date {
  const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;
  const shifted = new Date(Date.now() + ADDIS_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      ADDIS_OFFSET_MS,
  );
}
