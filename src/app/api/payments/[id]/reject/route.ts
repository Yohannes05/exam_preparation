import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireAdmin } from "@/lib/auth";
import { jsonify } from "@/lib/serialize";
import { TelegramClient } from "@/lib/telegram";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** POST /api/payments/{id}/reject — reject with a required reason. */
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason === "" || reason.length > 200) {
      throw new ApiError(422, "The given data was invalid.", {
        reason: reason === "" ? ["The reason field is required."] : ["The reason may not be greater than 200 characters."],
      });
    }

    const paymentId = Number(params.id);

    const payment = await prisma.$transaction(async (tx) => {
      const payment = await tx.telegramPayment.findUnique({
        where: { id: paymentId },
        include: { student: { include: { grade: true } } },
      });
      if (!payment) throw new ApiError(404, "Not found.");
      if (payment.status !== "pending") {
        throw new ApiError(409, "This receipt has already been reviewed.");
      }

      return tx.telegramPayment.update({
        where: { id: paymentId },
        data: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewReason: reason,
        },
        include: { student: { include: { grade: true } } },
      });
    });

    await new TelegramClient().sendMessage(
      Number(payment.student.telegramId),
      `❌ We could not approve your receipt. ${reason} Please send a corrected receipt or contact support.`,
    );

    const safe = jsonify(payment) as Record<string, unknown>;
    delete safe.receipt_file_id;

    return NextResponse.json({ payment: safe });
  } catch (error) {
    return errorResponse(error);
  }
}
