/**
 * Port of backend/app/Services/Telegram/TelegramClient.php.
 *
 * Thin Telegram Bot API wrapper. When mock mode is on (no bot token or
 * TELEGRAM_MOCK=true) calls are recorded in `sentLog` instead of hitting
 * api.telegram.org — this drives local development and the smoke tests.
 */

import { config, telegramMock } from "./config";

export type InlineKeyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>;
export type ReplyKeyboard = Array<Array<{ text: string }>>;

export type SentCall = {
  method: string;
  chatId?: number;
  payload: Record<string, unknown>;
};

export type FailedCall = { chatId: number; text: string; error: string };

type Tam = { sent: SentCall[]; failed: FailedCall[] };
const g = globalThis as unknown as { __telegramSent?: Tam };
export const log: Tam = g.__telegramSent ?? { sent: [], failed: [] };
g.__telegramSent = log;

/** Test helper: reset the recorded call log. */
export function resetTelegramLog(): void {
  log.sent = [];
  log.failed = [];
}

/** Recorded outgoing messages (texts), for assertions. */
export function messagesFor(chatId: number): string[] {
  return log.sent
    .filter((call) => call.method === "sendMessage" && call.chatId === chatId)
    .map((call) => String(call.payload.text ?? ""));
}

export class TelegramClient {
  private get token(): string {
    return config.telegram.token;
  }

  mock(token = this.token): boolean {
    return telegramMock(token);
  }

  /** @return {ok, result?, description?} raw Telegram envelope. */
  async call(method: string, payload: Record<string, unknown> = {}, returnEnvelope = false): Promise<Record<string, unknown>> {
    log.sent.push({
      method,
      chatId: typeof payload.chat_id === "number" ? payload.chat_id : undefined,
      payload,
    });

    if (this.mock()) return { ok: true, result: {} };

    let body: Record<string, unknown>;
    try {
      const response = await fetch(`${config.telegram.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        // Telegram accepts form encoding of JSON-looking values fine, but
        // reply_markup must be a JSON string, matching the PHP client.
        body: new URLSearchParams(
          Object.entries(payload).map(([key, value]) => [
            key,
            key === "reply_markup" && typeof value === "object"
              ? JSON.stringify(value)
              : String(value ?? ""),
          ]),
        ),
        signal: AbortSignal.timeout(15_000),
      });
      body = { ok: false, description: `HTTP ${response.status}` } as Record<string, unknown>;
      if (response.ok) body = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new Error(this.safeTelegramError(method, error instanceof Error ? error.message : String(error)));
    }

    if (!body.ok) {
      throw new Error(`Telegram ${method} failed: ${String(body.description ?? "unknown API error")}`);
    }
    return returnEnvelope ? body : body;
  }

  /** Resolve the bot username for deep links when it is not configured. */
  async getBotUsername(): Promise<string | null> {
    if (this.mock()) return null;
    try {
      const response = await this.call("getMe", {}, true);
      const result = response.result as { username?: string } | undefined;
      return result?.username || null;
    } catch {
      return null;
    }
  }

  async getMe(): Promise<Record<string, unknown>> {
    return this.call("getMe", {}, true);
  }

  async sendMessage(
    chatId: number,
    text: string,
    keyboard: InlineKeyboard | null = null,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };

    // Telegram blacklists aggressively right after a success — retry with backoff.
    for (let attempt = 1, backoff = 1; ; attempt++) {
      try {
        await this.call("sendMessage", payload);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 3) {
          log.failed.push({ chatId, text: text.slice(0, 40), error: message });
          console.error(`[telegram] sendMessage to ${chatId} failed: ${message}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
        backoff = Math.min(backoff * 2, 10);
      }
    }
  }

  /** Send a screen with Telegram's keyboard below the message input. */
  async sendReplyMessage(chatId: number, text: string, keyboard: ReplyKeyboard | null = null): Promise<void> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (keyboard) {
      payload.reply_markup = { keyboard, resize_keyboard: true, is_persistent: true };
    }
    await this.call("sendMessage", payload);
  }

  /** Send an existing Telegram photo by its file_id with an optional caption. */
  async sendPhoto(chatId: number, photo: string, caption?: string, keyboard: InlineKeyboard | null = null): Promise<void> {
    const payload: Record<string, unknown> = { chat_id: chatId, photo };
    if (caption) {
      payload.caption = caption.slice(0, 1000);
      payload.parse_mode = "HTML";
    }
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    await this.call("sendPhoto", payload);
  }

  /** Send an existing Telegram document by its file_id. */
  async sendDocument(chatId: number, document: string, caption?: string): Promise<void> {
    const payload: Record<string, unknown> = { chat_id: chatId, document };
    if (caption) {
      payload.caption = caption.slice(0, 1000);
      payload.parse_mode = "HTML";
    }
    await this.call("sendDocument", payload);
  }

  /** Download a private Telegram file without exposing the bot token to the admin UI. */
  async downloadFile(fileId: string): Promise<{ contents: ArrayBuffer; mime: string } | null> {
    if (this.mock()) return null;

    const file = (await this.call("getFile", { file_id: fileId }, true)) as {
      result?: { file_path?: string };
    };
    const path = file.result?.file_path;
    if (!path || path.includes("..")) {
      throw new Error("Telegram did not return a valid receipt file.");
    }

    const response = await fetch(
      `${rtrim(config.telegram.apiBase, "/")}/file/bot${this.token}/${ltrimSlash(path)}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) {
      throw new Error(`Receipt download failed: HTTP ${response.status}`);
    }

    return {
      contents: await response.arrayBuffer(),
      mime: response.headers.get("content-type") || "application/octet-stream",
    };
  }

  async editMessage(chatId: number, messageId: number, text: string, keyboard: InlineKeyboard | null = null): Promise<void> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
    await this.call("editMessageText", payload);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) {
      payload.text = text;
      payload.show_alert = false;
    }
    await this.call("answerCallbackQuery", payload);
  }

  async setWebhook(url: string, secret?: string, dropPending = false): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { url, drop_pending_updates: dropPending };
    if (secret) payload.secret_token = secret;
    return this.call("setWebhook", payload, true);
  }

  async getWebhookInfo(): Promise<Record<string, unknown>> {
    return this.call("getWebhookInfo", {}, true);
  }

  async deleteWebhook(dropPending = false): Promise<Record<string, unknown>> {
    return this.call("deleteWebhook", { drop_pending_updates: dropPending }, true);
  }

  /**
   * Long-poll getUpdates (used by scripts/telegram-poll.ts).
   * timeout=0 returns immediately with pending updates.
   */
  async getUpdates(offset = 0, timeout = 50): Promise<Array<Record<string, unknown>>> {
    if (this.mock()) return [];

    try {
      const response = await fetch(
        `${config.telegram.apiBase}/bot${this.token}/getUpdates?` +
          new URLSearchParams({
            offset: String(offset),
            timeout: String(timeout),
            allowed_updates: JSON.stringify(["message", "callback_query"]),
          }),
        { signal: AbortSignal.timeout((timeout + 15) * 1000) },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as { ok?: boolean; description?: string; result?: unknown[] };
      if (!body.ok) {
        throw new Error(body.description || "Telegram getUpdates request failed.");
      }
      return (body.result ?? []) as Array<Record<string, unknown>>;
    } catch (error) {
      throw new Error(this.safeTelegramError("getUpdates", error instanceof Error ? error.message : String(error)));
    }
  }

  /** Check if a user is a member of the bot's channel (spec §1, §4). */
  async checkChannelMembership(telegramId: number): Promise<boolean> {
    // Mock mode deliberately allows local development without Telegram access.
    if (this.mock()) return true;

    try {
      const response = await fetch(
        `${config.telegram.apiBase}/bot${this.token}/getChatMember?` +
          new URLSearchParams({
            chat_id: `@${ltrimAt(config.telegram.channelUsername)}`,
            user_id: String(telegramId),
          }),
        { signal: AbortSignal.timeout(10_000) },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        result?: { status?: string; is_member?: boolean };
      };
      if (!data.ok) return false;
      const member = data.result;
      if (!member) return false;
      return (
        ["creator", "administrator", "member"].includes(member.status ?? "") ||
        (member.status === "restricted" && member.is_member === true)
      );
    } catch {
      return false;
    }
  }

  protected safeTelegramError(method: string, message: string): string {
    if (this.token) {
      message = message.replace(`bot${this.token}`, "bot[REDACTED]");
    }
    return `Telegram ${method} request failed: ${message}`;
  }
}

function rtrim(value: string, char: string): string {
  return value.endsWith(char) ? value.slice(0, -char.length) : value;
}

function ltrimSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function ltrimAt(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}
