/**
 * Port of backend/config/telegram.php + config/services.php +
 * config/payment-related envs. All values come from the environment.
 */
export const config = {
  app: {
    url: process.env.APP_URL || "http://localhost:3000",
    isProduction: process.env.NODE_ENV === "production",
    name: "Exam Prep",
  },
  auth: {
    secret: process.env.ADMIN_SESSION_SECRET || "dev-secret-change-me",
  },
  telegram: {
    get token() {
      return process.env.TELEGRAM_BOT_TOKEN || "";
    },
    username: process.env.TELEGRAM_BOT_USERNAME || "bot",
    secret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    apiBase: process.env.TELEGRAM_API_BASE || "https://api.telegram.org",
    channelUsername: process.env.TELEGRAM_CHANNEL_USERNAME || "exitexamprep",
    get channelUrl() {
      return `https://t.me/${ltrim(this.channelUsername, "@")}`;
    },
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID
      ? Number(process.env.TELEGRAM_ADMIN_CHAT_ID)
      : null,
    payment: {
      price: Number(process.env.TELEGRAM_ACTIVATION_PRICE || 200),
      telebirrNumber: process.env.TELEGRAM_TELEBIRR_NUMBER || "",
      cbeAccount: process.env.TELEGRAM_CBE_ACCOUNT || "",
      cbeAccountName: process.env.TELEGRAM_CBE_ACCOUNT_NAME || "",
      adminUsername: process.env.TELEGRAM_SUPPORT_USERNAME || "",
    },
    freeDailyLimit: Number(process.env.TELEGRAM_FREE_DAILY_LIMIT || 10),
    mock: process.env.TELEGRAM_MOCK === "true",
    pageSize: 5, // questions per message page
  },
  telegraph: {
    accessToken: process.env.TELEGRAPH_ACCESS_TOKEN || "",
  },
  supabase: {
    storage: {
      url: process.env.SUPABASE_URL || "",
      bucket: process.env.SUPABASE_STORAGE_BUCKET || "lesson-files",
      key: process.env.SUPABASE_STORAGE_SERVICE_KEY || "",
    },
  },
  cronSecret: process.env.CRON_SECRET || "",
};

export function ltrim(value: string, char: string): string {
  return value.startsWith(char) ? value.slice(char.length) : value;
}

export function telegramMock(token = config.telegram.token): boolean {
  return config.telegram.mock || !token;
}
