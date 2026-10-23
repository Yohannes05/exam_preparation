import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TelegramClient } from "@/lib/telegram";
import { errorResponse } from "@/lib/auth";

type Params = { params: { id: string } };

/** GET /api/payments/{id}/receipt — proxy the receipt image from Telegram. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const payment = await prisma.telegramPayment.findUnique({ where: { id: Number(params.id) } });
    if (!payment) {
      return NextResponse.json({ message: "Not found." }, { status: 404 });
    }

    const telegram = new TelegramClient();
    const file = await telegram.downloadFile(payment.receiptFileId);
    if (file === null) {
      return NextResponse.json(
        { message: "Receipt preview is unavailable while Telegram is in mock mode." },
        { status: 404 },
      );
    }

    if (!file.mime.toLowerCase().startsWith("image/")) {
      return NextResponse.json(
        { message: "The receipt file is not an image." },
        { status: 415 },
      );
    }

    return new NextResponse(file.contents, {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
