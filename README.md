# Exam Prep — Next.js Port

Next.js + Prisma replacement for the Laravel Telegram quiz-bot backend:
Telegram bot (conversation state machine), admin dashboard, REST API for the
admin CRUD, import, and payments review.

## Quick start (dev)

```bash
npm install
npx prisma db push            # creates the SQLite file at prisma/db.sqlite
npm run db:seed               # grade/subject/chapter/questions/exams + demo student
npm run admin:create          # admin@example.com / admin1234 (override with args)
npm run dev                   # http://localhost:3000
```

- Admin login: `http://localhost:3000/login` (cookie session via JWT in `jose`)
- Generic CRUD is served by `/api/v1/[resource]` and rendered at `/admin/crud/<resource>`

## Environment

```
DATABASE_URL="file:./db.sqlite"     # or a postgres:// URL with db:push-pg + schema.postgres.prisma
ADMIN_SESSION_SECRET="..."          # JWT signing secret
TELEGRAM_BOT_TOKEN=""               # leave empty to run the bot in (unsupported) mock mode
TELEGRAM_WEBHOOK_SECRET=""
ADMIN_BASE_URL=""                   # public URL, used by scripts/telegram-webhook.ts
TELEGRAM_CHANNEL_USERNAME=""        # required-entry channel
TELEGRAM_ACTIVATION_PRICE=200
TELEGRAM_TELEBIRR_NUMBER=""
TELEGRAM_CBE_ACCOUNT=""
```

All Telegram-specific flags mirror the Laravel `config/telegram.php` keys.

## Scripts

| Command                        | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `npm run dev` / `build`        | Next.js dev server / production build          |
| `npm run db:push`, `db:seed`   | Prisma schema push + dev seed                  |
| `npm run admin:create`         | create/update an admin user                    |
| `npm run telegram:webhook`     | register/remove the Telegram webhook           |
| `npm run typecheck`            | `tsc --noEmit`                                 |

## HTTP surface

- `POST /api/telegram/webhook` — Telegram updates, state machine in `src/lib/bot.ts`
- `POST /api/cron/remind-expiring` — cron reminders for expiring activations
- `GET/POST /api/<resource>` / `GET/PUT/DELETE /api/<resource>/<id>` — admin CRUD
  (grades, subjects, chapters, topics, notes, questions, exams, announcements,
  students, payments, results)
- `POST /api/import/xlsx` — spreadsheet question import
- `/api/results/<id>` — per-question attempt breakdown

See `../README.md` for the product spec this port implements.
