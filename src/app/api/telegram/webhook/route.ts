import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { BotHandler } from "@/lib/bot";

/**
 * POST /api/telegram/webhook
 *
 * Verifies the Telegram secret token header, then hands the update to the
 * conversation state machine (BotHandler).
 */
export async function POST(request: Request) {
  const secret = config.telegram.secret;

  if (config.app.isProduction && !secret) {
    return NextResponse.json(
      { message: "Telegram webhook secret is not configured." },
      { status: 503 },
    );
  }

  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token");
    if (header !== secret) {
      return NextResponse.json({ message: "Invalid webhook secret." }, { status: 403 });
    }
  }

  const update = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (update === null || update.update_id === undefined) {
    return NextResponse.json({ message: "Not a Telegram update." }, { status: 422 });
  }

  await new BotHandler().handle(update);

  return NextResponse.json({ ok: true });
}
