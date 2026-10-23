/**
 * Sets or deletes the Telegram webhook for this deployment.
 *
 * Usage:
 *   ADMIN_BASE_URL=https://your-app.com TELEGRAM_WEBHOOK_SECRET=your-secret \
 *   npx tsx scripts/telegram-webhook.ts set
 *   npx tsx scripts/telegram-webhook.ts delete
 */
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const baseUrl = process.env.ADMIN_BASE_URL ?? "http://localhost:3000";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const action = process.argv[2] ?? "set";

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is required.");
    process.exitCode = 1;
    return;
  }

  const apiBase = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, "");
  const method = action === "delete" ? "deleteWebhook" : "setWebhook";
  const url = `${apiBase}/bot${token}/${method}`;

  const params: Record<string, string> =
    action === "delete"
      ? {}
      : {
          url: `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`,
          secret_token: secret ?? "",
          allowed_updates: JSON.stringify(["message", "callback_query", "pre_checkout_query"]),
          drop_pending_updates: "false",
        };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const contentType = response.headers.get("content-type") ?? "unknown content type";
    const responseText = await response.text();
    let body: { ok?: boolean; description?: string };
    try {
      body = JSON.parse(responseText) as { ok?: boolean; description?: string };
    } catch {
      console.error(
        `Telegram API returned HTTP ${response.status} with ${contentType}, not JSON. ` +
          "Check TELEGRAM_API_BASE and whether your network proxy/firewall is intercepting api.telegram.org.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(action, response.ok && body.ok ? "succeeded" : "failed", body.description ?? `HTTP ${response.status}`);
    if (!response.ok || !body.ok) process.exitCode = 1;
  } catch (error) {
    console.error("Could not reach the Telegram Bot API:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();

export {};
