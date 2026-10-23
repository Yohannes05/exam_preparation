import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let prisma: (typeof import("../src/lib/db"))["prisma"];
let BotHandler: (typeof import("../src/lib/bot"))["BotHandler"];
let messagesFor: (typeof import("../src/lib/telegram"))["messagesFor"];
let resetTelegramLog: (typeof import("../src/lib/telegram"))["resetTelegramLog"];
let telegramLog: (typeof import("../src/lib/telegram"))["log"];
let telegramId: number;
let gradeId: number;
let subjectId: number;
let chapterId: number;
let questionId: number;
let correctOptionId: number;
let temporaryDirectory: string;

before(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "exam-prep-telegram-test-"));
  const temporaryDatabase = join(temporaryDirectory, "test.db");
  copyFileSync(resolve("prisma/dev.db"), temporaryDatabase);

  // Point the application singleton at a disposable copy before importing it.
  process.env.DATABASE_URL = `file:${temporaryDatabase}`;
  process.env.TELEGRAM_BOT_TOKEN = "";
  process.env.TELEGRAM_MOCK = "true";

  ({ prisma } = await import("../src/lib/db"));
  ({ BotHandler } = await import("../src/lib/bot"));
  ({ messagesFor, resetTelegramLog, log: telegramLog } = await import("../src/lib/telegram"));

  const grade = await prisma.grade.findFirst({ where: { level: 12 } });
  assert.ok(grade, "test database should contain Grade 12");
  const subject = await prisma.subject.create({ data: { gradeId: grade.id, name: "Flow Test Subject" } });
  const naturalSubject = await prisma.subject.create({ data: { gradeId: grade.id, name: "Physics", stream: "natural" } });
  const socialSubject = await prisma.subject.create({ data: { gradeId: grade.id, name: "History", stream: "social" } });
  const chapter = await prisma.chapter.create({ data: { subjectId: subject.id, title: "Flow Test Chapter" } });
  const question = await prisma.question.create({
    data: {
      gradeId: grade.id,
      subjectId: subject.id,
      chapterId: chapter.id,
      questionText: "Which option is correct?",
      options: {
        create: [
          { label: "A", text: "Correct", isCorrect: true },
          { label: "B", text: "Incorrect", isCorrect: false },
        ],
      },
    },
    include: { options: true },
  });

  telegramId = Date.now();
  gradeId = grade.id;
  subjectId = subject.id;
  chapterId = chapter.id;
  questionId = question.id;
  correctOptionId = question.options.find((option) => option.isCorrect)!.id;
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("Telegram student can register, select a grade, start practice, and answer", async () => {
  resetTelegramLog();
  const bot = new BotHandler();
  const message = (text: string) => ({
    update_id: Date.now(),
    message: { chat: { id: telegramId }, from: { id: telegramId, first_name: "Flow" }, text },
  });
  const callback = (data: string) => ({
    update_id: Date.now(),
    callback_query: {
      id: `test-${Date.now()}`,
      from: { id: telegramId, first_name: "Flow" },
      message: { chat: { id: telegramId }, message_id: 1 },
      data,
    },
  });

  await bot.handle(message("/start"));
  assert.match(messagesFor(telegramId).join("\n"), /Choose your grade to start practising/i);
  const gradeKeyboard = telegramLog.sent.filter((call) => call.chatId === telegramId && call.method === "sendMessage" && call.payload.reply_markup !== undefined).at(-1)?.payload.reply_markup as { keyboard?: Array<Array<{ text: string }>> } | undefined;
  assert.ok(gradeKeyboard?.keyboard?.some((row) => row.some((button) => button.text === "Natural · Grade 12") && row.some((button) => button.text === "Social · Grade 12")), "Grade 12 streams should appear side by side");

  await bot.handle(callback(`g:${gradeId}:natural`));
  assert.match(messagesFor(telegramId).join("\n"), /Choose a subject/i);
  const subjectKeyboard = telegramLog.sent.filter((call) => call.chatId === telegramId && call.method === "sendMessage").at(-1)?.payload.reply_markup as { keyboard?: Array<Array<{ text: string }>> } | undefined;
  const listedSubjects = subjectKeyboard?.keyboard?.flat().map((button) => button.text).join(" ") ?? "";
  assert.match(listedSubjects, /Physics/);
  assert.doesNotMatch(listedSubjects, /History/);

  await bot.handle(callback(`s:${subjectId}`));
  assert.match(messagesFor(telegramId).join("\n"), /Choose notes or a chapter quiz/i);

  await bot.handle(callback(`chapter_quiz:${chapterId}`));
  assert.match(messagesFor(telegramId).join("\n"), /Which option is correct\?/);
  assert.equal((await prisma.botSession.findUnique({ where: { chatId: BigInt(telegramId) } }))?.state, "practice");

  await bot.handle(callback(`o:${correctOptionId}`));

  const student = await prisma.student.findUnique({ where: { telegramId: BigInt(telegramId) } });
  assert.ok(student);
  assert.equal(student.gradeId, gradeId);
  assert.equal(student.stream, "natural");
  assert.equal(await prisma.questionAttempt.count({ where: { studentId: student.id, questionId, isCorrect: true } }), 1);
  const outgoingText = telegramLog.sent
    .filter((call) => call.chatId === telegramId)
    .map((call) => String(call.payload.text ?? ""))
    .join("\n");
  assert.match(outgoingText, /Correct!/);

  // The integration flow should have persisted its test fixture only in the copy.
  assert.ok(await prisma.chapter.findUnique({ where: { id: chapterId } }));
});
