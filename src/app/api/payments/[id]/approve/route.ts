import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { jsonify } from "@/lib/serialize";
import { TelegramClient } from "@/lib/telegram";
import { formatAddis } from "@/lib/time";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const ACTIVATION_DAYS = 30;

/** POST /api/payments/{id}/approve — activate the student for 30 days. */
export async function POST(_request: Request, { params }: Params) {
  try {
    await requireAdmin();

    const paymentId = Number(params.id);

    const { payment, validUntil } = await prisma.$transaction(async (tx) => {
      const payment = await tx.telegramPayment.findUnique({
        where: { id: paymentId },
        include: { student: { include: { grade: true } } },
      });
      if (!payment) {
        throw Object.assign(new Error("Not found."), { status: 404 });
      }
      if (payment.status !== "pending") {
        throw Object.assign(new Error("This receipt has already been reviewed."), { status: 409 });
      }

      const student = payment.student;
      const startsAt =
        student.activatedUntil && student.activatedUntil.getTime() > Date.now()
          ? student.activatedUntil
          : new Date();
      const validUntil = new Date(startsAt.getTime() + ACTIVATION_DAYS * 86_400_000);

      const [updated] = await Promise.all([
        tx.telegramPayment.update({
          where: { id: paymentId },
          data: {
            status: "approved",
            reviewedAt: new Date(),
            validUntil,
            reviewReason: null,
          },
          include: { student: { include: { grade: true } } },
        }),
        tx.student.update({
          where: { id: student.id },
          data: { activatedUntil: validUntil },
        }),
      ]);

      return { payment: updated, validUntil };
    });

    await new TelegramClient().sendMessage(
      Number(payment.student.telegramId),
      `✅ Your payment was approved. Your account is active until <b>${formatAddis(validUntil)}</b>.`,
    );

    const safe = jsonify(payment) as Record<string, unknown>;
    delete safe.receipt_file_id;

    return NextResponse.json({ payment: safe, activated_until: validUntil });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Request failed." },
        { status: Number((error as { status: number }).status) },
      );
    }
    return errorResponse(error);
  }
}
