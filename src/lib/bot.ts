/**
 * Port of backend/app/Services/Telegram/BotHandler.php.
 *
 * Telegram conversation state machine (spec §3).
 * Flow: /start → choose grade → menu → Study / Practice / Test / Mock /
 * Progress / Mistakes / Announcements / Settings.
 * All state lives server-side in bot_sessions; callback data is kept short.
 */

import { prisma } from "./db";
import {
  TelegramClient,
  log as telegramLog,
  type InlineKeyboard,
} from "./telegram";
import { config } from "./config";
import { addisMidnightUtc, formatAddis, isoWeekId } from "./time";
import { parseJson, jsonify } from "./serialize";
import { url as storageUrl } from "./storage";
import {
  awardQuizPoints,
  recordAnswer,
  mistakes as listMistakes,
  weeklyScore,
  weeklyRank,
  allTimeScore,
  allTimeRank,
} from "./progress";
import {
  startAttempt,
  answer as answerAttempt,
  finalize,
  examSecondsLeft,
  attemptAnswers,
  attemptQuestionIds,
} from "./exam";

type Nil = undefined | null;

type TelegramUser = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  chat?: { id?: number };
  from?: TelegramUser;
  text?: string;
  photo?: Array<{ file_id?: string }>;
  message_id?: number;
};

type TelegramCallback = {
  id?: string;
  data?: string;
  from?: TelegramUser;
  message?: { chat?: { id?: number }; message_id?: number };
};

type TelegramUpdate = {
  callback_query?: TelegramCallback;
  message?: TelegramMessage;
};

type SessionContext = Record<string, unknown>;

type StudentRow = {
  id: number;
  telegramId: bigint;
  telegramUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  gradeId: number | null;
  stream: string | null;
  activatedUntil: Date | null;
};

type SessionRow = {
  id: number;
  chatId: bigint;
  studentId: number | null;
  state: string;
  context: string | null;
  replyKeyboard: string | null;
};

/** Bot session helpers (port of App\Models\BotSession). */
export async function sessionForChat(chatId: number): Promise<SessionRow> {
  return prisma.botSession.upsert({
    where: { chatId: BigInt(chatId) },
    create: { chatId: BigInt(chatId) },
    update: {},
    select: {
      id: true,
      chatId: true,
      studentId: true,
      state: true,
      context: true,
      replyKeyboard: true,
    },
  }) as unknown as Promise<SessionRow>;
}

async function setSessionState(session: SessionRow, state: string, context: SessionContext | null = null): Promise<void> {
  await prisma.botSession.update({
    where: { id: session.id },
    data: {
      state,
      ...(context !== null ? { context: JSON.stringify(context) } : {}),
    },
  });
  session.state = state;
  if (context !== null) session.context = JSON.stringify(context);
}

async function putSessionContext(session: SessionRow, values: SessionContext): Promise<void> {
  const merged = { ...sessionContext(session), ...values };
  session.context = JSON.stringify(merged);
  await prisma.botSession.update({
    where: { id: session.id },
    data: { context: session.context },
  });
}

export function sessionContext(session: SessionRow): SessionContext {
  return parseJson<SessionContext>(session.context, {});
}

export class BotHandler {
  private tg = new TelegramClient();
  private session!: SessionRow;
  private student!: StudentRow;
  private chatId = 0;
  private callbackMessageId = 0;
  /** Recorded failures before this update, for the smoke tests. */
  failedBefore = 0;

  async handle(update: TelegramUpdate | Record<string, unknown>): Promise<void> {
    const data = update as TelegramUpdate;
    this.failedBefore = telegramLog.failed.length;

    if (data.callback_query) {
      await this.handleCallback(data.callback_query);
      return;
    }

    if (data.message?.photo?.length) {
      await this.handleReceiptPhoto(data.message);
      return;
    }

    if (data.message?.text !== undefined) {
      await this.handleMessage(data.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Entry points                                                        */
  /* ------------------------------------------------------------------ */

  private async handleCallback(callback: TelegramCallback): Promise<void> {
    const data = String(callback.data ?? "");
    this.callbackMessageId = Number(callback.message?.message_id ?? 0);
    const [actionRaw, argRaw, extraRaw] = data.split(":");
    const arg = argRaw ?? "";

    if (actionRaw === "payment_approve" || actionRaw === "payment_reject") {
      await this.reviewPayment(callback, actionRaw, Number(arg));
      return;
    }

    const chatId = Number(callback.message?.chat?.id ?? callback.from?.id);
    await this.begin(chatId, callback.from);

    if (callback.id) {
      await this.tg.answerCallbackQuery(callback.id).catch(() => undefined);
    }

    // Do not let crafted or stale callbacks bypass the first-visit channel gate.
    // Help and contact are intentionally available before joining (spec §4).
    const bypass = ["join_confirmed", "help_contact", "help", "howto", "contact"];
    const hasChannelCheck = await prisma.channelCheck.findUnique({
      where: { telegramId: this.student.telegramId },
    });
    if (!bypass.includes(actionRaw) && !hasChannelCheck && !(await this.checkChannelAndNavigate())) {
      return;
    }

    const action = actionRaw;
    switch (action ?? "") {
      case "": case "start": return this.start();
      case "menu": return this.showMenu();
      case "subjects": return this.showSubjects(null);
      case "g": return this.selectGrade(Number(arg), extraRaw);
      case "mode": return this.showSubjects(arg);
      case "s": return this.showChapters(Number(arg));
      case "c": return this.chapterChosen(Number(arg));
      case "chapter_notes": return this.openChapterNote(Number(arg));
      case "chapter_quiz": return this.startPractice(Number(arg));
      case "practice_questions": return this.showPracticeSources();
      case "notes": return this.showNotes(Number(arg || (sessionContext(this.session).chapter_id as number ?? 0)));
      case "n": case "note_prev": case "note_next": return this.showNote(Number(arg));
      case "pdf": return this.downloadNotePdf(Number(arg));
      case "chapter_pdf": return this.downloadChapterPdf(Number(arg));
      case "o": return this.answerOption(Number(arg));
      case "next": return this.nextQuestion();
      case "stop": return this.finishPractice();
      case "quiz_retry": return this.retryQuestionSet();
      case "e": case "retry": return this.startExam(Number(arg));
      case "review": return this.showReview();
      case "progress": return this.showProgress();
      case "mistakes": return this.startMistakes();
      case "announce": return this.showAnnouncements();
      case "settings": return this.showSettings();
      case "grade": return this.showGradeList();
      case "leaderboard": return this.showLeaderboard();
      case "notice": return this.showNotice();
      case "help_contact": case "help": return this.sendHelp();
      case "howto": return this.showHowTo();
      case "contact": return this.sendContact();
      case "activate": return this.showActivate();
      case "referrals": return this.showReferrals();
      case "receipt": return this.requestReceipt(arg);
      case "join_confirmed": return this.confirmChannelJoin();
      case "random": return this.showRandomQuestions();
      case "model": return this.showModelExam();
      case "national": return this.showNationalExam();
      case "tier": return this.selectTier(Number(arg || 10));
      case "year": return this.selectYear(Number(arg || 2024));
      default: return this.showMenu();
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = Number(message.chat?.id ?? 0);
    const text = String(message.text ?? "").trim();
    let referrerTelegramId: number | null = null;

    const startMatch = /^\/start(?:@\w+)?(?:\s+ref_(\d+))?$/i.exec(text);
    const isStartCommand = startMatch !== null;
    if (isStartCommand && startMatch[1]) {
      referrerTelegramId = Number(startMatch[1]);
    }

    await this.begin(chatId, message.from, referrerTelegramId);

    if (isStartCommand || text === "start") {
      await this.start();
      return;
    }

    if (text === "join_confirmed") {
      await this.confirmChannelJoin();
      return;
    }

    if (text === "/menu" || text === "/help") {
      if (text === "/help") {
        await this.sendHelp();
      } else {
        const hasChannelCheck = await prisma.channelCheck.findUnique({
          where: { telegramId: this.student.telegramId },
        });
        if (hasChannelCheck || (await this.checkChannelAndNavigate())) {
          await this.showMenu();
        }
      }
      return;
    }

    if (text.startsWith("/")) {
      await this.sendHelp();
      return;
    }

    const session = this.session;
    const keyboardActions = parseJson<Record<string, string>>(
      session.replyKeyboard,
      {},
    );
    const selectedAction = keyboardActions[text] ?? null;

    if (typeof selectedAction === "string" && selectedAction.startsWith("url:")) {
      const url = selectedAction.slice(4);
      await this.send(this.chatId, `🔗 <a href="${escapeHtml(url)}">Open link</a>`);
      return;
    }

    const hasChannelCheck = await prisma.channelCheck.findUnique({
      where: { telegramId: this.student.telegramId },
    });
    if (!hasChannelCheck && !(await this.checkChannelAndNavigate())) {
      return;
    }

    if (
      !this.student.gradeId &&
      /^(?:grade\s*)?(6|8|12)(?:st|nd|th)?$/i.test(text)
    ) {
      const level = Number(/^(?:grade\s*)?(6|8|12)(?:st|nd|th)?$/i.exec(text)![1]);
      const grade = await prisma.grade.findFirst({
        where: { level, isActive: true },
      });
      if (grade) {
        await this.selectGrade(grade.id);
      } else {
        await this.send(this.chatId, "That grade is not available. Please choose from the available grades below.", await this.gradeKeyboard());
      }
      return;
    }

    if (typeof selectedAction === "string") {
      await this.handleCallback({
        id: "",
        from: message.from,
        message: { chat: { id: chatId } },
        data: selectedAction,
      });
      return;
    }

    // Free-text input: no state currently accepts it — re-prompt politely.
    switch (this.session.state) {
      case "choose_grade":
        await this.send(this.chatId, "Please pick your grade from the buttons below 👇", await this.gradeKeyboard());
        break;
      case "practice":
      case "exam":
      case "mistakes":
        await this.send(
          this.chatId,
          "Please answer using the option buttons above 👆",
          this.session.state === "exam" ? [[{ text: "🏠 Menu", callback_data: "menu" }]] : null,
        );
        break;
      default:
        await this.showMenu();
    }
  }

  private async begin(chatId: number, from: TelegramUser | Nil, referrerTelegramId: number | null = null): Promise<void> {
    this.chatId = chatId;
    this.session = await sessionForChat(chatId);

    const telegramId = BigInt(from?.id ?? chatId);
    let student = await prisma.student.findUnique({
      where: { telegramId },
    }) as StudentRow | null;

    if (!student) {
      student = (await prisma.student.create({
        data: {
          telegramId,
          telegramUsername: from?.username ?? null,
          firstName: from?.first_name ?? null,
          lastName: from?.last_name ?? null,
          joinedAt: new Date(),
        },
      })) as StudentRow;

      if (referrerTelegramId && BigInt(referrerTelegramId) !== telegramId) {
        const referrer = await prisma.student.findUnique({ where: { telegramId: BigInt(referrerTelegramId) } });
        if (referrer) {
          await prisma.referral.create({
            data: { referrerStudentId: referrer.id, referredStudentId: student.id },
          });
        }
      }
    } else {
      student = (await prisma.student.update({
        where: { id: student.id },
        data: {
          telegramUsername: from?.username ?? student.telegramUsername,
          firstName: from?.first_name ?? student.firstName,
          lastName: from?.last_name ?? student.lastName,
          lastSeenAt: new Date(),
        },
      })) as StudentRow;
    }

    this.student = student;

    if (this.session.studentId !== student.id) {
      await prisma.botSession.update({
        where: { id: this.session.id },
        data: { studentId: student.id },
      });
      this.session.studentId = student.id;
    }
  }

  /** Check channel membership on first visit (spec §1, §4). */
  private async checkChannelAndNavigate(): Promise<boolean> {
    const existing = await prisma.channelCheck.findUnique({
      where: { telegramId: this.student.telegramId },
    });
    if (existing) return true;

    if (await this.tg.checkChannelMembership(Number(this.student.telegramId))) {
      await prisma.channelCheck.upsert({
        where: { telegramId: this.student.telegramId },
        create: { telegramId: this.student.telegramId, joinedConfirmedAt: new Date() },
        update: { joinedConfirmedAt: new Date() },
      });
      return true;
    }

    // Not a member: show join buttons.
    await this.send(
      this.chatId,
      "❌ <b>Please join our channel to use the bot.</b>\n\nYou only need to do this once.",
      this.joinChannelKeyboard(),
    );
    await setSessionState(this.session, "join_channel");
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Start / registration (spec §1, §4)                                  */
  /* ------------------------------------------------------------------ */

  private async start(): Promise<void> {
    if (!(await this.checkChannelAndNavigate())) return;

    await this.qualifyReferral();

    if (this.student.gradeId) {
      const currentGrade = await prisma.grade.findUnique({ where: { id: this.student.gradeId }, select: { level: true } });
      if (currentGrade?.level === 12 && !this.student.stream) {
        await this.showGradeList();
        return;
      }
      await this.showMenu();
      return;
    }

    const name = this.student.firstName ? `, ${this.student.firstName}` : "";
    await this.send(
      this.chatId,
      `👋 Welcome${name}!\n\nChoose your grade to start practising, or pick another option:`,
      await this.menuKeyboard(),
    );
    await setSessionState(this.session, "menu");
  }

  private async gradeKeyboard(): Promise<InlineKeyboard> {
    const grades = await prisma.grade.findMany({
      where: { isActive: true },
      orderBy: { level: "asc" },
      select: { id: true, name: true, level: true },
    });

    const rows = gradeButtonRows(grades);

    return rows.length ? rows : [[{ text: "🏠 Menu", callback_data: "menu" }]];
  }

  /** Join channel keyboard (first visit). */
  private joinChannelKeyboard(): InlineKeyboard {
    return [
      [{ text: "📢 Join channel", url: config.telegram.channelUrl }],
      [{ text: "✅ I joined", callback_data: "join_confirmed" }],
    ];
  }

  private async showGradeList(): Promise<void> {
    await this.send(this.chatId, "🔽 Select your grade:", await this.gradeKeyboard());
    await setSessionState(this.session, "choose_grade");
  }

  private async selectGrade(gradeId: number, stream?: string): Promise<void> {
    const grade = await prisma.grade.findFirst({ where: { id: gradeId, isActive: true } });

    if (!grade) {
      await this.send(this.chatId, "Sorry, that grade is not available.", await this.gradeKeyboard());
      return;
    }

    if (grade.level === 12 && stream !== "natural" && stream !== "social") {
      await this.send(this.chatId, "Choose your Grade 12 stream:", [
        [{ text: "Natural · Grade 12", callback_data: `g:${grade.id}:natural` }],
        [{ text: "Social · Grade 12", callback_data: `g:${grade.id}:social` }],
      ]);
      await setSessionState(this.session, "choose_stream");
      return;
    }
    const selectedStream = grade.level === 12 ? stream! : null;

    await prisma.student.update({ where: { id: this.student.id }, data: { gradeId: grade.id, stream: selectedStream } });
    this.student.gradeId = grade.id;
    this.student.stream = selectedStream;

    await putSessionContext(this.session, { mode: "study", tier: null });
    await this.showSubjects(null);
  }

  /* ------------------------------------------------------------------ */
  /* Main menu                                                           */
  /* ------------------------------------------------------------------ */

  private async menuKeyboard(): Promise<InlineKeyboard> {
    const grades = await prisma.grade.findMany({
      where: { isActive: true },
      orderBy: { level: "asc" },
      select: { id: true, name: true, level: true },
    });

    const keyboard: InlineKeyboard = [[{ text: "አጠቃቀሙ · How to use", callback_data: "howto" }]];
    keyboard.push(...gradeButtonRows(grades));

    keyboard.push([
      { text: "💰 To Activate", callback_data: "activate" },
      { text: "📊 Leaderboard", callback_data: "leaderboard" },
    ]);
    keyboard.push([
      { text: "📢 Notice", callback_data: "notice" },
      { text: "📢 Join Channel", url: config.telegram.channelUrl },
    ]);
    keyboard.push([
      { text: "❓ Help", callback_data: "help" },
      { text: "☎️ Contact", callback_data: "contact" },
    ]);

    return keyboard;
  }

  private async showMenu(): Promise<void> {
    await this.send(this.chatId, "🏠 <b>Main menu</b>\nWhat would you like to do?", await this.menuKeyboard());
    await setSessionState(this.session, "menu");
  }

  /** Show the student's weekly and lifetime points/ranks within their grade. */
  private async showLeaderboard(): Promise<void> {
    if (!(await this.requireGrade())) return;

    const [week, weekRank, allTime, allRank] = await Promise.all([
      weeklyScore(prisma, this.student.id),
      weeklyRank(prisma, this.student),
      allTimeScore(prisma, this.student.id),
      allTimeRank(prisma, this.student),
    ]);

    await this.send(
      this.chatId,
      "📊 <b>Your leaderboard" + "</b>\n\n" +
        `⭐ Weekly score: <b>${week}</b> · Rank: <b>${weekRank ? `#${weekRank}` : "—"}</b>\n` +
        `🏫 All-time score: <b>${allTime}</b> · Rank: <b>${allRank ? `#${allRank}` : "—"}</b>`,
      [[{ text: "🏠 Home", callback_data: "menu" }]],
    );
  }

  /** Show the student's unique invite link. */
  private async showReferrals(): Promise<void> {
    const username = ltrimAt(config.telegram.username);
    if (username === "" || username === "bot") {
      await this.send(
        this.chatId,
        "🎁 Referral links are being configured. Please check back soon.",
        [[{ text: "🏠 Home", callback_data: "menu" }]],
      );
      return;
    }

    const link = `https://t.me/${username}?start=ref_${this.student.telegramId}`;
    const [qualified, rewardsEarned] = await Promise.all([
      prisma.referral.count({
        where: { referrerStudentId: this.student.id, qualifiedAt: { not: null } },
      }),
      prisma.referralReward.count({ where: { referrerStudentId: this.student.id } }),
    ]);
    const remainingInGroup = qualified % 5;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
      "Join me on the Grade Quiz bot and practise together!",
    )}`;

    await this.send(
      this.chatId,
      `🎁 <b>Invite friends and earn activation</b>\n\n` +
        `Share your personal link:\n<code>${link}</code>\n\n` +
        `Eligible friends: <b>${qualified}</b> · Rewards earned: <b>${rewardsEarned}</b> · Progress: <b>${remainingInGroup}/5</b> toward your next 30-day reward.` +
        `\n\nA friend counts after joining the required channel. Every five unique friends earns you 30 days of activation.`,
      [
        [{ text: "📤 Share my invite link", url: shareUrl }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ],
    );
  }

  /** Qualify one referred student and award each five-referral milestone once. */
  private async qualifyReferral(): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const referral = await tx.referral.findFirst({
        where: { referredStudentId: this.student.id },
      });
      if (!referral || referral.qualifiedAt) return;

      const referrer = await tx.student.findUnique({ where: { id: referral.referrerStudentId } });
      await tx.referral.update({ where: { id: referral.id }, data: { qualifiedAt: new Date() } });
      if (!referrer) return;

      const qualifiedCount = await tx.referral.count({
        where: { referrerStudentId: referrer.id, qualifiedAt: { not: null } },
      });
      if (qualifiedCount < 5 || qualifiedCount % 5 !== 0) return;

      const startsAt =
        referrer.activatedUntil && referrer.activatedUntil.getTime() > Date.now()
          ? referrer.activatedUntil
          : new Date();
      const validUntil = new Date(startsAt.getTime() + 30 * 86_400_000);
      await tx.referralReward.create({
        data: {
          referrerStudentId: referrer.id,
          referralMilestone: qualifiedCount,
          activatedUntil: validUntil,
        },
      });
      await tx.student.update({
        where: { id: referrer.id },
        data: { activatedUntil: validUntil },
      });

      await this.tg.sendMessage(
        Number(referrer.telegramId),
        `🎉 Five of your invited students have joined! Your account now has 30 more days of activation and is active until <b>${formatAddis(validUntil)}</b>.`,
      );
    });
  }

  /** Notice: pinned announcements. */
  private async showNotice(): Promise<void> {
    const activated = await this.isActivated();
    const where = {
      isPublished: true,
      OR: [
        { audience: "all" },
        { audience: "grade", gradeId: this.student.gradeId ?? 0 },
        { audience: "activated" },
      ],
      ...(activated ? {} : { audience: { not: "activated" } }),
    };

    const notice = await prisma.announcement.findFirst({ where, orderBy: { id: "desc" } });

    await this.send(
      this.chatId,
      notice ? `📢 <b>${escapeHtml(notice.title)}</b>\n\n${escapeHtml(notice.body)}` : "📭 There are no notices for your grade yet.",
      [[{ text: "🏠 Home", callback_data: "menu" }]],
    );
  }

  /** Help and contact: how the bot works + support contact. */
  private async sendHelp(): Promise<void> {
    await this.send(
      this.chatId,
      "ℹ️ <b>Help · እገዛ</b>\n\n" +
        "Choose a grade, subject and chapter. Read notes or answer the quiz buttons one at a time. Each answer shows the correct choice and explanation.\n\n" +
        `Free accounts can answer up to ${config.telegram.freeDailyLimit} questions per day. Use To Activate for unlimited practice.\n\n` +
        "Use /menu to return home.",
      [
        [{ text: "☎️ Contact · አግኙን", callback_data: "contact" }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ],
    );
  }

  private async showHowTo(): Promise<void> {
    await this.send(
      this.chatId,
      "📘 <b>አጠቃቀሙ · How to use</b>\n\n" +
        "1. Choose your grade and subject.\n2. Choose a chapter and read its notes.\n3. Take a chapter quiz or choose a question set.\n4. Tap an answer to see the correct answer and explanation.\n5. Review mistakes and check your progress.",
      [[{ text: "🏠 Home", callback_data: "menu" }]],
    );
  }

  private async sendContact(): Promise<void> {
    const username = ltrimAt(config.telegram.payment.adminUsername);
    if (username === "") {
      await this.send(this.chatId, "Support contact is not configured yet.", await this.menuKeyboard());
      return;
    }

    await this.send(this.chatId, `☎️ Contact support for questions or payment help: @${escapeHtml(username)}`, [
      [{ text: `Message @${username}`, url: `https://t.me/${username}` }],
      [{ text: "🏠 Home", callback_data: "menu" }],
    ]);
  }

  private async requireGrade(): Promise<boolean> {
    if (this.student.gradeId) {
      const grade = await prisma.grade.findUnique({ where: { id: this.student.gradeId }, select: { level: true } });
      if (grade?.level !== 12 || this.student.stream === "natural" || this.student.stream === "social") return true;
    }

    await this.send(this.chatId, "Please choose your grade first 👇", await this.gradeKeyboard());
    await setSessionState(this.session, "choose_grade");
    return false;
  }

  private async confirmChannelJoin(): Promise<void> {
    if (!(await this.tg.checkChannelMembership(Number(this.student.telegramId)))) {
      await this.send(
        this.chatId,
        "❌ <b>I couldn't find you in the channel yet.</b> Please join, then try again.",
        this.joinChannelKeyboard(),
      );
      await setSessionState(this.session, "join_channel");
      return;
    }

    await prisma.channelCheck.upsert({
      where: { telegramId: this.student.telegramId },
      create: { telegramId: this.student.telegramId, joinedConfirmedAt: new Date() },
      update: { joinedConfirmedAt: new Date() },
    });

    await this.qualifyReferral();

    await this.send(
      this.chatId,
      "✅ <b>Thanks for joining!</b>\n\nHome is now open. Choose your grade to start practising.",
      await this.gradeKeyboard(),
    );
    await setSessionState(this.session, "choose_grade");
  }

  /** Persist and forward a student payment receipt for admin review. */
  private async handleReceiptPhoto(message: TelegramMessage): Promise<void> {
    const chatId = Number(message.chat?.id ?? 0);
    await this.begin(chatId, message.from);

    if (this.session.state !== "awaiting_payment_receipt") {
      await this.send(chatId, "To submit a payment receipt, open To Activate first.", await this.menuKeyboard());
      return;
    }

    const photos = message.photo ?? [];
    const photo = photos[photos.length - 1];
    const fileId = photo?.file_id;

    if (!fileId) {
      await this.send(chatId, "I could not read that image. Please send the receipt as a photo.");
      return;
    }

    const context = sessionContext(this.session);
    const payment = await prisma.telegramPayment.create({
      data: {
        studentId: this.student.id,
        receiptFileId: fileId,
        method: String(context.payment_method ?? "unknown"),
        amount: config.telegram.payment.price || 150,
        status: "pending",
      },
    });

    const adminChatId = config.telegram.adminChatId;
    if (adminChatId) {
      const method = payment.method === "telebirr" ? "Telebirr" : "CBE Birr";
      const grade = this.student.gradeId
        ? await prisma.grade.findUnique({ where: { id: this.student.gradeId } })
        : null;
      const username = this.student.telegramUsername ? ` (@${this.student.telegramUsername})` : "";
      const caption =
        `🧾 <b>New payment receipt #${payment.id}</b>\n` +
        `Student: ${escapeHtml(displayName(this.student))}${username}\n` +
        `Grade: ${escapeHtml(grade?.name ?? "not selected")}\n` +
        `Method: <b>${method}</b>\nAmount: <b>${payment.amount} birr</b>`;

      await this.tg.sendPhoto(adminChatId, fileId, caption, [
        [{ text: "✅ Approve", callback_data: `payment_approve:${payment.id}` }],
        [{ text: "❌ Reject", callback_data: `payment_reject:${payment.id}` }],
      ]);

      await this.send(chatId, "✅ Receipt received. An admin will review it and message you here.", await this.menuKeyboard());
    } else {
      await this.send(chatId, "✅ Receipt saved, but the admin chat is not configured yet. Please contact support.", await this.menuKeyboard());
    }

    await setSessionState(this.session, "menu", {});
  }

  /** Approve or reject a submitted payment from the configured admin account. */
  private async reviewPayment(callback: TelegramCallback, action: string, paymentId: number): Promise<void> {
    const adminId = config.telegram.adminChatId;
    const fromId = Number(callback.from?.id ?? 0);

    if (!adminId || fromId !== adminId) {
      await this.tg.answerCallbackQuery(String(callback.id ?? ""), "You are not allowed to review payments.");
      return;
    }

    const payment = await prisma.telegramPayment.findUnique({
      where: { id: paymentId },
      include: { student: true },
    });

    if (!payment || payment.status !== "pending") {
      await this.tg.answerCallbackQuery(String(callback.id ?? ""), "This receipt has already been reviewed.");
      return;
    }

    if (action === "payment_approve") {
      const startsAt =
        payment.student.activatedUntil && payment.student.activatedUntil.getTime() > Date.now()
          ? payment.student.activatedUntil
          : new Date();
      const validUntil = new Date(startsAt.getTime() + 30 * 86_400_000);

      await prisma.$transaction([
        prisma.telegramPayment.update({
          where: { id: paymentId },
          data: { status: "approved", reviewedAt: new Date(), validUntil, reviewReason: null },
        }),
        prisma.student.update({
          where: { id: payment.studentId },
          data: { activatedUntil: validUntil },
        }),
      ]);

      await this.tg.sendMessage(
        Number(payment.student.telegramId),
        `✅ Your payment was approved. Your account is active until <b>${formatAddis(validUntil)}</b>.`,
      );
      await this.tg.answerCallbackQuery(String(callback.id ?? ""), "Payment approved.");
      return;
    }

    await prisma.telegramPayment.update({
      where: { id: paymentId },
      data: { status: "rejected", reviewedAt: new Date() },
    });
    await this.send(
      Number(payment.student.telegramId),
      "❌ We could not approve your receipt. Please send a clearer or correct receipt from To Activate.",
      [[{ text: "💰 To Activate", callback_data: "activate" }]],
    );
    await this.tg.answerCallbackQuery(String(callback.id ?? ""), "Payment rejected.");
  }

  /** Explain monthly activation and direct the student to manual receipt review. */
  private async showActivate(): Promise<void> {
    const price = config.telegram.payment.price || 150;
    const telebirr = config.telegram.payment.telebirrNumber;
    const cbeAccount = config.telegram.payment.cbeAccount;
    const cbeName = config.telegram.payment.cbeAccountName;
    const activeUntil = this.student.activatedUntil;
    const status =
      activeUntil && activeUntil.getTime() > Date.now()
        ? `✅ Your account is active until <b>${formatAddis(activeUntil)}</b>. You can renew below.\n\n`
        : "";

    const paymentDetails =
      `Telebirr: <b>${telebirr || "Please contact support for the number"}</b>\n` +
      `CBE Birr: <b>${cbeAccount ? `${cbeName ? `${cbeName} · ` : ""}${cbeAccount}` : "Please contact support for the account"}</b>`;

    const support = config.telegram.payment.adminUsername || "@J0519";
    await this.send(
      this.chatId,
      `💰 <b>Activate your account</b>\n${status}` +
        `Pay <b>${price} birr</b> for 30 days using one of these methods:\n${paymentDetails}\n\n` +
        `After paying, send your receipt screenshot manually to <b>${escapeHtml(support)}</b>. An admin will review it and activate your account.`,
      [
        [{ text: "☎️ Message support", url: `https://t.me/${ltrimAt(support)}` }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ],
    );
  }

  private async requestReceipt(method: string): Promise<void> {
    if (!["telebirr", "cbe_birr"].includes(method)) {
      await this.showActivate();
      return;
    }

    await setSessionState(this.session, "awaiting_payment_receipt", { payment_method: method });

    const label = method === "telebirr" ? "Telebirr" : "CBE Birr";
    await this.send(
      this.chatId,
      `📷 Please send a clear photo of your <b>${label}</b> payment receipt.\n\nAn admin will review it and message you here.`,
      [[{ text: "Cancel", callback_data: "activate" }]],
    );
  }

  /** Random questions: pick a subject and chapter to draw random questions. */
  private async showRandomQuestions(): Promise<void> {
    const context = sessionContext(this.session);
    if (context.subject_id) {
      await putSessionContext(this.session, { scope: "subject", chapter_id: null });
      await this.showQuestionTiers(0, "random");
      return;
    }
    await this.showSubjects("random");
  }

  /** Model exam: pick a subject, chapter, and year to take a model exam. */
  private async showModelExam(): Promise<void> {
    const context = sessionContext(this.session);
    if (context.subject_id) {
      await putSessionContext(this.session, { scope: "subject", chapter_id: null });
      await this.showExamYear(0, "model");
      return;
    }
    await this.showSubjects("model");
  }

  /** National exam: pick a subject, chapter, and year to take the national exam. */
  private async showNationalExam(): Promise<void> {
    const context = sessionContext(this.session);
    if (context.subject_id) {
      await putSessionContext(this.session, { scope: "subject", chapter_id: null });
      await this.showExamYear(0, "national");
      return;
    }
    await this.showSubjects("national");
  }

  private async showPracticeSources(): Promise<void> {
    const context = sessionContext(this.session);
    await this.send(this.chatId, "✏️ <b>Practice Questions</b>\nChoose a question set:", [
      [{ text: "🎲 All Random", callback_data: "random" }],
      [{ text: "📝 Model Exams", callback_data: "model" }],
      [{ text: "🏛️ National Exams", callback_data: "national" }],
      [{ text: "◀️ Back to chapters", callback_data: `s:${Number(context.subject_id ?? 0)}` }],
      [{ text: "🏠 Home", callback_data: "menu" }],
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* Navigation: subject → chapter                                       */
  /* ------------------------------------------------------------------ */

  private async showSubjects(mode: string | Nil): Promise<void> {
    if (!(await this.requireGrade())) return;

    const effectiveMode = mode ?? "study";
    await putSessionContext(this.session, { mode: effectiveMode });

    const subjects = await prisma.subject.findMany({
      where: { gradeId: this.student.gradeId ?? 0, isActive: true, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    });

    if (subjects.length === 0) {
      await this.send(this.chatId, "No subjects are available for your grade yet.", await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    const keyboard: InlineKeyboard = [];
    for (let i = 0; i < subjects.length; i += 2) {
      keyboard.push(
        subjects.slice(i, i + 2).map((subject) => ({ text: subject.name, callback_data: `s:${subject.id}` })),
      );
    }
    keyboard.push([{ text: "◀️ Back to Home", callback_data: "menu" }]);

    const grade = this.student.gradeId ? await prisma.grade.findUnique({ where: { id: this.student.gradeId } }) : null;
    const trackLabel = this.student.stream ? ` · ${this.student.stream === "natural" ? "Natural" : "Social"}` : "";
    await this.send(this.chatId, `${escapeHtml(grade?.name ?? "Grade")}${escapeHtml(trackLabel)} — Choose a subject 👇`, keyboard);
    await setSessionState(this.session, "choose_subject");
  }

  private async showChapters(subjectId: number, mode: string | Nil = null): Promise<void> {
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, gradeId: this.student.gradeId ?? 0, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
    });

    if (!subject) {
      await this.showMenu();
      return;
    }

    const context = sessionContext(this.session);
    const effectiveMode = mode ?? String(context.mode ?? "study");
    await putSessionContext(this.session, {
      subject_id: subject.id,
      subject_name: subject.name,
      mode: effectiveMode,
    });

    if (["random", "model", "national"].includes(effectiveMode)) {
      await putSessionContext(this.session, { scope: "subject", chapter_id: null });
      if (effectiveMode === "random") {
        await this.showQuestionTiers(0, effectiveMode);
      } else {
        await this.showExamYear(0, effectiveMode);
      }
      return;
    }

    await putSessionContext(this.session, { scope: "chapter" });

    const chapters = await prisma.chapter.findMany({
      where: { subjectId: subject.id, isActive: true, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, title: true, order: true, requiresActivation: true },
    });

    if (chapters.length === 0) {
      await this.send(this.chatId, `No chapters yet in <b>${escapeHtml(subject.name)}</b>.`, await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    const keyboard: InlineKeyboard = chapters.map((chapter, index) => [
      {
        text: `${chapter.requiresActivation ? "🔒 " : ""}Chapter ${index + 1} · Notes`,
        callback_data: `chapter_notes:${chapter.id}`,
      },
      {
        text: `${chapter.requiresActivation ? "🔒 " : ""}Chapter ${index + 1} · Quiz (10 Q)`,
        callback_data: `chapter_quiz:${chapter.id}`,
      },
    ]);
    keyboard.push([{ text: "Practice Questions", callback_data: "practice_questions" }]);
    keyboard.push([{ text: "◀️ Back to subjects", callback_data: "subjects" }]);

    await this.send(this.chatId, `📖 <b>${escapeHtml(subject.name)}</b>\nChoose notes or a chapter quiz:`, keyboard);
    await setSessionState(this.session, "choose_chapter");
  }

  private async chapterChosen(chapterId: number): Promise<void> {
    const mode = String(sessionContext(this.session).mode ?? "study");
    await putSessionContext(this.session, { chapter_id: chapterId });

    switch (mode) {
      case "study": return this.showNotes(chapterId);
      case "practice": return this.startPractice(chapterId);
      case "test":
      case "mock": return this.showExams(chapterId);
      case "random": return this.showQuestionTiers(chapterId, "random");
      case "model": return this.showExamYear(chapterId, "model");
      case "national": return this.showExamYear(chapterId, "national");
      default: return this.showMenu();
    }
  }

  /** Tier selector for random questions and chapter-by-chapter exams. */
  private async showQuestionTiers(chapterId: number, mode: string): Promise<void> {
    void chapterId;
    await putSessionContext(this.session, { tier: null, mode });
    await this.showTierSelector(mode);
  }

  /** Year selector for model/national exam, then tier. */
  private async showExamYear(chapterId: number, examType: string): Promise<void> {
    void chapterId;
    await putSessionContext(this.session, { tier: null, mode: examType });

    const pool = await this.questionPool(examType);
    const years = [...new Set(
      pool
        .filter((question) => question.year != null)
        .map((question) => Number(question.year)),
    )].sort((a, b) => a - b);

    if (years.length === 0) {
      await this.send(this.chatId, `No ${escapeHtml(examType)} exam questions are available for this subject yet.`, [
        [{ text: "◀️ Back", callback_data: `mode:${examType}` }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ]);
      return;
    }

    const keyboard: InlineKeyboard = [];
    for (let i = 0; i < years.length; i += 2) {
      keyboard.push(years.slice(i, i + 2).map((year) => ({ text: `${year} E.C.`, callback_data: `year:${year}` })));
    }
    keyboard.push([{ text: "◀️ Back", callback_data: `mode:${examType}` }]);
    keyboard.push([{ text: "🏠 Home", callback_data: "menu" }]);

    const context = sessionContext(this.session);
    await this.send(
      this.chatId,
      `📝 <b>${escapeHtml(String(context.subject_name ?? ""))} · ${escapeHtml(examType.charAt(0).toUpperCase() + examType.slice(1))} Exams</b>\n\nChoose a year:`,
      keyboard,
    );
  }

  /** Question-tier keyboard (10 / 30 / 50 / 100). */
  private tierKeyboard(availableSizes: number[]): InlineKeyboard {
    const buttons = availableSizes.map((size) => ({
      text: `${size} questions${!this.isActivated() && size > 10 ? " 🔒" : ""}`,
      callback_data: `tier:${size}`,
    }));
    const keyboard: InlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboard.push(buttons.slice(i, i + 2));
    }
    keyboard.push([{ text: "◀️ Back", callback_data: `mode:${String(sessionContext(this.session).mode ?? "practice")}` }]);
    keyboard.push([{ text: "🏠 Home", callback_data: "menu" }]);
    return keyboard;
  }

  private async showTierSelector(mode: string): Promise<void> {
    const context = sessionContext(this.session);
    const pool = await this.questionPool(mode, context.year != null ? Number(context.year) : null);
    const available = pool.length;
    const sizes = [10, 30, 50, 100].filter((size) => available >= size);

    if (sizes.length === 0) {
      await this.send(this.chatId, "There are not enough questions in this set yet.", [
        [{ text: "◀️ Back", callback_data: `mode:${mode}` }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ]);
      return;
    }

    const source = mode === "model" ? "Model exam" : mode === "national" ? "National exam" : "Random practice";
    const title = escapeHtml(String(context.subject_name ?? "Questions"));
    await this.send(
      this.chatId,
      `🎯 <b>${title} · ${source}</b>\n\n` +
        `Choose the number of questions:${this.isActivated() ? "" : `\n🔒 Larger sets require activation. Free students can answer up to ${config.telegram.freeDailyLimit} questions per day.`}`,
      this.tierKeyboard(sizes),
    );
  }

  private async questionPool(mode?: string | null, year?: number | null) {
    const context = sessionContext(this.session);
    const effectiveMode = mode ?? String(context.mode ?? "random");

    const freeChapterIds = this.isActivated()
      ? []
      : (
          await prisma.chapter.findMany({
            where: {
              subjectId: Number(context.subject_id ?? 0),
              isActive: true,
              requiresActivation: false,
              OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])],
            },
            select: { id: true },
          })
        ).map((chapter) => chapter.id);

    const where = {
      isActive: true,
      gradeId: this.student.gradeId ?? 0,
      subjectId: Number(context.subject_id ?? 0),
      options: { some: { isCorrect: true } },
      ...(this.isActivated() ? {} : {
        OR: [{ chapterId: { in: freeChapterIds } }, { chapterId: null }],
      }),
      AND: [{ OR: [
        { chapterId: null },
        { chapter: { is: { OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] } } },
      ] }],
      ...((context.scope ?? "subject") === "chapter" && context.chapter_id
        ? { chapterId: Number(context.chapter_id) }
        : {}),
      ...(["model", "national"].includes(effectiveMode) ? { source: { contains: effectiveMode } } : {}),
      ...(year != null ? { year } : {}),
    };

    return prisma.question.findMany({ where, select: { id: true, year: true, difficulty: true } });
  }

  /** Select a question tier (10 / 30 / 50 / 100). */
  private async selectTier(tier: number): Promise<void> {
    if (![10, 30, 50, 100].includes(tier)) {
      await this.showMenu();
      return;
    }
    if (tier > 10 && !(await this.isActivated())) {
      await this.showActivate();
      return;
    }

    await putSessionContext(this.session, { tier });

    const context = sessionContext(this.session);
    const mode = String(context.mode ?? "study");
    const chapterId = Number(context.chapter_id ?? 0);

    if (mode === "random") {
      await this.drawRandomQuestions(chapterId);
    } else if (mode === "model") {
      await this.drawModelExam(chapterId, Number(context.year ?? 2024));
    } else if (mode === "national") {
      await this.drawNationalExam(chapterId, Number(context.year ?? 2024));
    } else {
      await this.showMenu();
    }
  }

  /** Select a year for model/national exam. */
  private async selectYear(year: number): Promise<void> {
    const context = sessionContext(this.session);
    const pool = await this.questionPool(String(context.mode ?? ""), year);
    if (pool.length === 0) {
      await this.showMenu();
      return;
    }

    await putSessionContext(this.session, { year });

    const mode = String(context.mode ?? "study");
    if (!["model", "national"].includes(mode)) {
      await this.showMenu();
      return;
    }

    await this.showQuestionTiers(Number(context.chapter_id ?? 0), mode);
  }

  /** Draw random questions from a chapter (respecting the selected tier). */
  private async drawRandomQuestions(chapterId: number): Promise<void> {
    void chapterId;
    const tier = Number(sessionContext(this.session).tier ?? 10);
    const questions = await drawSample(await this.questionPoolIds("random"), tier);
    await this.startQuestionSet(questions, "Random practice", "random", "practice", "practice", quizMetadata(this.session));
  }

  /** Draw a model exam paper (respecting year and tier). */
  private async drawModelExam(chapterId: number, year: number): Promise<void> {
    void chapterId;
    const tier = Number(sessionContext(this.session).tier ?? 10);
    const questions = await drawSample(await this.questionPoolIds("model", year), tier);
    await this.startQuestionSet(questions, `Model exam ${year} E.C.`, "model", "practice", "practice", quizMetadata(this.session));
  }

  /** Draw a national exam paper (respecting year and tier). */
  private async drawNationalExam(chapterId: number, year: number): Promise<void> {
    void chapterId;
    const tier = Number(sessionContext(this.session).tier ?? 10);
    const questions = await drawSample(await this.questionPoolIds("national", year), tier);
    await this.startQuestionSet(questions, `National exam ${year} E.C.`, "national", "practice", "practice", quizMetadata(this.session));
  }

  private async questionPoolIds(mode?: string | null, year?: number | null): Promise<number[]> {
    return (await this.questionPool(mode, year)).map((question) => question.id);
  }

  /* ------------------------------------------------------------------ */
  /* Study: notes (spec §5)                                              */
  /* ------------------------------------------------------------------ */

  private async showNotes(chapterId: number): Promise<void> {
    const chapter = await prisma.chapter.findFirst({ where: {
      id: chapterId,
      OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])],
      subject: { gradeId: this.student.gradeId ?? 0, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
    } });

    if (!chapter) {
      await this.showMenu();
      return;
    }

    await putSessionContext(this.session, { chapter_id: chapterId, chapter_title: chapter.title });

    const notes = await prisma.note.findMany({
      where: { chapterId, gradeId: this.student.gradeId ?? 0 },
      orderBy: { order: "asc" },
      select: { id: true, title: true },
    });

    const keyboard: InlineKeyboard = [];
    for (let i = 0; i < notes.length; i += 2) {
      keyboard.push(notes.slice(i, i + 2).map((note) => ({ text: `📄 ${note.title}`, callback_data: `n:${note.id}` })));
    }
    keyboard.push([{ text: "◀️ Chapters", callback_data: `s:${chapter.subjectId}` }]);
    keyboard.push([{ text: "🏠 Menu", callback_data: "menu" }]);

    await this.send(this.chatId, `📚 <b>${escapeHtml(chapter.title)}</b>\nSelect study notes 👇`, keyboard);
    await setSessionState(this.session, "study_notes");
  }

  private async openChapterNote(chapterId: number): Promise<void> {
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        isActive: true,
        OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])],
        subject: { gradeId: this.student.gradeId ?? 0, isActive: true, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
      },
    });
    if (!chapter) {
      await this.showMenu();
      return;
    }
    if (chapter.requiresActivation && !(await this.isActivated())) {
      await this.send(
        this.chatId,
        "🔒 <b>This chapter requires account activation.</b> Activate your account to open its notes and quizzes.",
        [
          [{ text: "💰 To Activate", callback_data: "activate" }],
          [{ text: "◀️ Back to chapters", callback_data: `s:${chapter.subjectId}` }],
          [{ text: "🏠 Home", callback_data: "menu" }],
        ],
      );
      return;
    }
    if (chapter.telegraphUrl) {
      const keyboard: InlineKeyboard = [[{ text: "📖 Read chapter notes", url: chapter.telegraphUrl }]];
      if (chapter.pdfFile) {
        keyboard.push([
          {
            text: this.isActivated() ? "⬇ Download chapter PDF" : "🔒 Chapter PDF (activate)",
            callback_data: `chapter_pdf:${chapter.id}`,
          },
        ]);
      }
      keyboard.push([{ text: "📝 Take chapter quiz", callback_data: `chapter_quiz:${chapter.id}` }]);
      keyboard.push([{ text: "◀️ Back to chapters", callback_data: `s:${chapter.subjectId}` }]);
      keyboard.push([{ text: "🏠 Home", callback_data: "menu" }]);
      await this.send(
        this.chatId,
        `📚 <b>Chapter ${chapter.order || ""} · ${escapeHtml(chapter.title)}</b>\nRead the notes or download the PDF.`,
        keyboard,
      );
      return;
    }
    const note = await prisma.note.findFirst({
      where: { chapterId, gradeId: this.student.gradeId ?? 0 },
      orderBy: [{ pageNumber: "asc" }, { order: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!note) {
      const context = sessionContext(this.session);
      await this.send(this.chatId, "No notes are available for this chapter yet.", [
        [{ text: "◀️ Back to chapters", callback_data: `s:${Number(context.subject_id ?? 0)}` }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ]);
      return;
    }
    await this.showNote(note.id);
  }

  private async showNote(noteId: number): Promise<void> {
    const note = await prisma.note.findFirst({
      where: { id: noteId, gradeId: this.student.gradeId ?? 0, chapter: { OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] } },
    });

    if (!note) {
      await this.showMenu();
      return;
    }

    const chapter = await prisma.chapter.findUnique({ where: { id: note.chapterId } });
    if (!chapter || !chapter.isActive) {
      await this.showMenu();
      return;
    }
    if (chapter.requiresActivation && !(await this.isActivated())) {
      await this.send(
        this.chatId,
        "🔒 <b>This chapter requires account activation.</b> Activate your account to open its notes and quizzes.",
        [
          [{ text: "💰 To Activate", callback_data: "activate" }],
          [{ text: "◀️ Back to chapters", callback_data: `s:${chapter.subjectId}` }],
          [{ text: "🏠 Home", callback_data: "menu" }],
        ],
      );
      return;
    }

    const siblings = await prisma.note.findMany({
      where: { chapterId: note.chapterId, gradeId: this.student.gradeId ?? 0 },
      orderBy: [{ pageNumber: "asc" }, { order: "asc" }, { id: "asc" }],
      select: { id: true, title: true },
    });
    const index = siblings.findIndex((item) => item.id === note.id);
    const previous = index > 0 ? siblings[index - 1] : null;
    const next = index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;

    const keyboard: InlineKeyboard = [];
    const navigation: InlineKeyboard[0] = [];
    if (previous) navigation.push({ text: "◀ Previous", callback_data: `note_prev:${previous.id}` });
    if (next) navigation.push({ text: "Next ▶", callback_data: `note_next:${next.id}` });
    if (navigation.length) keyboard.push(navigation);
    if (note.pdfFile) {
      keyboard.push([{ text: "⬇ Download PDF notes", callback_data: `pdf:${note.id}` }]);
    }
    keyboard.push([{ text: "📝 Take chapter quiz", callback_data: `chapter_quiz:${note.chapterId}` }]);
    keyboard.push([{ text: "◀️ Back to chapters", callback_data: `s:${chapter.subjectId}` }]);
    keyboard.push([{ text: "🏠 Home", callback_data: "menu" }]);

    const page = index === -1 ? 1 : index + 1;
    const noteText = `📄 <b>${escapeHtml(note.title)}</b> · Page ${page}/${siblings.length}\n\n${escapeHtml(note.content)}`;
    if (this.callbackMessageId > 0 && this.session.state === "view_note") {
      await this.tg.editMessage(this.chatId, this.callbackMessageId, noteText, keyboard);
    } else {
      await this.send(this.chatId, noteText, keyboard);
    }

    if (note.imageFile) {
      await this.tg.sendPhoto(this.chatId, storageUrl(note.imageFile), "");
    }
    await setSessionState(this.session, "view_note");
  }

  private async downloadNotePdf(noteId: number): Promise<void> {
    const note = await prisma.note.findFirst({
      where: { id: noteId, gradeId: this.student.gradeId ?? 0, chapter: { OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] } },
    });
    if (!note || !note.pdfFile) {
      await this.send(this.chatId, "There is no PDF file available for this note yet.", await this.menuKeyboard());
      return;
    }

    if (!(await this.isActivated())) {
      await this.send(this.chatId, "🔒 Downloadable PDF notes are available to activated students.", [
        [{ text: "💰 To Activate", callback_data: "activate" }],
        [{ text: "◀️ Back to note", callback_data: `n:${note.id}` }],
      ]);
      return;
    }

    await this.tg.sendDocument(this.chatId, storageUrl(note.pdfFile), note.title);
  }

  private async downloadChapterPdf(chapterId: number): Promise<void> {
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        isActive: true,
        OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])],
        subject: { gradeId: this.student.gradeId ?? 0, isActive: true, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
      },
    });
    if (!chapter || !chapter.pdfFile) {
      await this.send(this.chatId, "There is no chapter PDF available yet.", await this.menuKeyboard());
      return;
    }
    if (!(await this.isActivated())) {
      await this.send(this.chatId, "🔒 Downloadable chapter PDFs are available to activated students.", [
        [{ text: "💰 To Activate", callback_data: "activate" }],
        [{ text: "◀️ Back to chapter", callback_data: `chapter_notes:${chapter.id}` }],
      ]);
      return;
    }
    await this.tg.sendDocument(
      this.chatId,
      storageUrl(chapter.pdfFile),
      `Chapter ${chapter.order || ""} · ${chapter.title}`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Practice + mistake review (spec §7, §11)                            */
  /* ------------------------------------------------------------------ */

  private async startPractice(chapterId: number, state = "practice", contextType = "practice"): Promise<void> {
    if (!(await this.requireGrade())) return;

    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        isActive: true,
        OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])],
        subject: { gradeId: this.student.gradeId ?? 0, isActive: true, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
      },
      include: { subject: { select: { name: true } } },
    });

    if (!chapter) {
      await this.showMenu();
      return;
    }

    if (chapter.requiresActivation && !(await this.isActivated())) {
      const chapterNumber = await this.chapterNumber(chapter.id, chapter.order);
      await this.send(
        this.chatId,
        `🔒 <b>Chapter ${chapterNumber} quiz requires activation.</b>\n\n` +
          "Chapter quizzes for Chapters 1–3 are available to free students. Activate your account to practise from Chapter 4 onward.",
        [
          [{ text: "💰 To Activate", callback_data: "activate" }],
          [{ text: "◀️ Back to chapters", callback_data: `s:${chapter.subjectId}` }],
          [{ text: "🏠 Home", callback_data: "menu" }],
        ],
      );
      return;
    }

    if (!(await this.isActivated()) && (await this.dailyQuestionsRemaining()) <= 0) {
      await this.showDailyLimit();
      return;
    }

    const remaining = await this.dailyQuestionsRemaining();
    const limit = this.isActivated() ? 10 : Math.min(10, remaining);
    const candidates = await prisma.question.findMany({
      where: { chapterId, gradeId: this.student.gradeId ?? 0, isActive: true },
      include: { options: { orderBy: { label: "asc" } } },
      orderBy: { id: "asc" },
    });
    const valid = candidates.filter((question) => hasValidOptions(question));
    const picked = shuffle(valid).slice(0, limit);

    if (picked.length === 0) {
      await this.send(this.chatId, "No practice questions are available for this chapter yet. Stay tuned! 🎯", await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    await this.startQuestionSet(picked, `Practice · ${chapter.title ?? ""}`, "chapter", state, contextType, {
      chapter_id: chapterId,
      subject_id: chapter.subjectId,
      subject_name: chapter.subject.name,
    });
  }

  /** Chapter numbering follows the ordered active list shown to students. */
  private async chapterNumber(chapterId: number, order: number): Promise<number> {
    const before = await prisma.chapter.count({
      where: {
        isActive: true,
        OR: [
          { order: { lt: order } },
          { order, id: { lt: chapterId } },
        ],
      },
    });
    return before + 1;
  }

  /** Start a one-question-at-a-time quiz from a prepared, random question set. */
  private async startQuestionSet(
    questions: Array<{ id: number } & Record<string, unknown>>,
    title: string,
    quizMode: string,
    state = "practice",
    contextType = "practice",
    metadata: SessionContext = {},
  ): Promise<void> {
    let set = questions.slice();

    if (!(await this.isActivated())) {
      const remaining = await this.dailyQuestionsRemaining();
      if (remaining <= 0) {
        await this.showDailyLimit();
        return;
      }
      set = set.slice(0, remaining);
    }

    if (set.length === 0) {
      await this.send(this.chatId, "No questions are available in this set yet.", await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    const context: SessionContext = {
      ...metadata,
      mode: state === "mistakes" ? "mistakes" : "practice",
      quiz_mode: quizMode,
      quiz_title: title,
      context: contextType,
      qids: set.map((question) => question.id),
      idx: 0,
      correct: 0,
      answered: 0,
      wrong_qids: [],
      answers: {},
      awaiting: true,
    };

    await prisma.botSession.update({
      where: { id: this.session.id },
      data: { state, context: JSON.stringify(context) },
    });
    this.session.state = state;
    this.session.context = JSON.stringify(context);

    await this.sendPracticeQuestion();
  }

  private isActivated(): boolean {
    return this.student.activatedUntil !== null && this.student.activatedUntil.getTime() > Date.now();
  }

  async isActivatedAsync(): Promise<boolean> {
    return this.isActivated();
  }

  private async dailyQuestionsRemaining(): Promise<number> {
    const answered = await prisma.questionAttempt.count({
      where: {
        studentId: this.student.id,
        answeredAt: { gte: addisMidnightUtc() },
      },
    });
    return Math.max(0, config.telegram.freeDailyLimit - answered);
  }

  private async showDailyLimit(): Promise<void> {
    await this.send(
      this.chatId,
      `⏳ <b>You have used your ${config.telegram.freeDailyLimit} free questions for today.</b>\n\n` +
        "Come back tomorrow, or activate your account to practise without a daily limit.",
      [
        [{ text: "💰 To Activate", callback_data: "activate" }],
        [{ text: "📚 Read chapter notes", callback_data: "mode:study" }],
        [{ text: "🏠 Home", callback_data: "menu" }],
      ],
    );
    await setSessionState(this.session, "menu");
  }

  private async startMistakes(): Promise<void> {
    if (!(await this.requireGrade())) return;

    const open = await listMistakes(prisma, this.student.id, config.telegram.pageSize);

    if (open.length === 0) {
      await this.send(
        this.chatId,
        "🎉 <b>No mistakes to review!</b>\nYou haven't missed any questions (or you've mastered them all).",
        await this.menuKeyboard(),
      );
      await setSessionState(this.session, "menu");
      return;
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: open.map((mistake) => mistake.questionId) } },
      include: { options: { orderBy: { label: "asc" } } },
    });
    await this.startQuestionSet(questions, "Mistake review", "mistakes", "mistakes", "mistake");
  }

  private async currentQuestion() {
    const context = sessionContext(this.session);
    const qids = (context.qids as number[] | undefined) ?? [];
    const idx = Number(context.idx ?? 0);
    return qids[idx] ? prisma.question.findUnique({
      where: { id: qids[idx] },
      include: { options: { orderBy: { label: "asc" } } },
    }) : null;
  }

  private async sendPracticeQuestion(): Promise<void> {
    const question = await this.currentQuestion();

    if (!question) {
      await this.finishPractice();
      return;
    }

    const context = sessionContext(this.session);
    const total = ((context.qids as number[] | undefined) ?? []).length;
    const prefix = context.context === "mistake" ? "❌ Review" : `✏️ ${escapeHtml(String(context.quiz_title ?? "Practice"))}`;

    await this.send(
      this.chatId,
      `${prefix} · Question (${Number(context.idx ?? 0) + 1}/${total}) <i>· ${question.difficulty}</i>\n\n` +
        `${escapeHtml(question.questionText)}\n\n${optionsText(question)}`,
      optionsKeyboard(question),
    );
    await putSessionContext(this.session, { awaiting: true });
  }

  private async answerOption(optionId: number): Promise<void> {
    if (!sessionContext(this.session).awaiting) {
      await this.send(this.chatId, "Please use the buttons on the latest question 👆");
      return;
    }

    switch (this.session.state) {
      case "practice":
      case "mistakes":
        return this.answerPracticeQuestion(optionId);
      case "exam":
        return this.answerExamQuestion(optionId);
      default:
        return this.showMenu();
    }
  }

  private async answerPracticeQuestion(optionId: number): Promise<void> {
    const question = await this.currentQuestion();

    if (!question) {
      await this.showMenu();
      return;
    }

    const option = question.options.find((candidate) => candidate.id === optionId);

    if (!option) {
      await this.send(this.chatId, "That option is no longer valid — showing the question again.");
      await this.sendPracticeQuestion();
      return;
    }

    const contextType = String(sessionContext(this.session).context ?? "practice");
    const correct = Boolean(option.isCorrect);

    await recordAnswer(prisma, this.student, question, option.id, correct, contextType as "practice" | "test" | "mock" | "mistake");

    const context = sessionContext(this.session);
    context.correct = Number(context.correct ?? 0) + (correct ? 1 : 0);
    context.answered = Number(context.answered ?? 0) + 1;
    context.answers = { ...(context.answers as Record<string, boolean>), [String(question.id)]: correct };
    if (!correct) {
      const wrong = (context.wrong_qids as number[] | undefined) ?? [];
      context.wrong_qids = [...new Set([...wrong, question.id])];
    }
    context.awaiting = false;
    await prisma.botSession.update({
      where: { id: this.session.id },
      data: { context: JSON.stringify(context) },
    });
    this.session.context = JSON.stringify(context);

    const questionNumber = Number(context.idx ?? 0) + 1;
    const questionTotal = ((context.qids as number[] | undefined) ?? []).length;
    const lines: string[] = [
      `✏️ <b>${escapeHtml(String(context.quiz_title ?? "Practice"))} · Question ${questionNumber}/${questionTotal}</b>`,
      escapeHtml(question.questionText),
    ];
    for (const answerOption of question.options) {
      const marker = answerOption.isCorrect ? "✅ " : answerOption.id === option.id ? "❌ " : "";
      lines.push(`${marker}<b>${answerOption.label})</b> ${escapeHtml(answerOption.text)}`);
    }
    lines.push(correct ? "\n✅ <b>Correct!</b>" : "\n❌ <b>Not correct.</b>");

    const correctOption = question.options.find((candidate) => candidate.isCorrect);
    if (correctOption) {
      lines.push(`Correct answer: <b>${correctOption.label})</b> ${escapeHtml(correctOption.text)}`);
    }

    if (contextType === "mistake" && correct) {
      lines.push("🎓 This one is now marked as <b>mastered</b>.");
    }

    if (question.explanation) {
      lines.push(`\n💡 ${escapeHtml(question.explanation)}`);
    }

    const idx = Number(context.idx ?? 0);
    const qids = (context.qids as number[] | undefined) ?? [];
    const isLast = idx + 1 >= qids.length;
    const summaryKeyboard: InlineKeyboard = [[
      { text: isLast ? "🏁 See results" : "Next question ➡️", callback_data: "next" },
    ]];

    if (this.callbackMessageId > 0) {
      await this.tg.editMessage(this.chatId, this.callbackMessageId, lines.join("\n"), summaryKeyboard);
    } else {
      await this.send(this.chatId, lines.join("\n"), summaryKeyboard);
    }
  }

  private async nextQuestion(): Promise<void> {
    const state = this.session.state;

    if (!["practice", "mistakes", "exam"].includes(state)) {
      await this.showMenu();
      return;
    }

    if (
      ["practice", "mistakes"].includes(state) &&
      !(await this.isActivated()) &&
      (await this.dailyQuestionsRemaining()) <= 0
    ) {
      await this.finishPractice(true);
      return;
    }

    const context = sessionContext(this.session);
    context.idx = Number(context.idx ?? 0) + 1;
    context.awaiting = true;
    await prisma.botSession.update({
      where: { id: this.session.id },
      data: { context: JSON.stringify(context) },
    });
    this.session.context = JSON.stringify(context);

    if (state === "exam") {
      await this.sendExamQuestion();
      return;
    }

    if (Number(context.idx) >= ((context.qids as number[] | undefined) ?? []).length) {
      await this.finishPractice();
      return;
    }

    await this.sendPracticeQuestion();
  }

  private async finishPractice(dailyLimitReached = false): Promise<void> {
    const context = sessionContext(this.session);
    const total = Number(context.answered ?? 0);
    const correct = Number(context.correct ?? 0);
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const isMistakes = context.context === "mistake";

    const heading = isMistakes ? "❌ <b>Mistake review complete!</b>" : "📘 <b>Practice complete!</b>";

    const answers = (context.answers as Record<string, boolean>) ?? {};
    const questions = await prisma.question.findMany({
      where: { id: { in: Object.keys(answers).map(Number) } },
      include: { chapter: true },
    });
    const byChapter = new Map<number, { title: string; total: number; correct: number }>();
    let weakest: { id: number; title: string; accuracy: number } | null = null;
    const lines: string[] = [];

    for (const [questionId, wasCorrect] of Object.entries(answers)) {
      const question = questions.find((candidate) => candidate.id === Number(questionId));
      if (!question) continue;
      // Unassigned questions count toward the overall result, but have no chapter to summarize.
      if (question.chapterId == null) continue;
      const entry = byChapter.get(question.chapterId) ?? {
        title: question.chapter?.title ?? "Unknown chapter",
        total: 0,
        correct: 0,
      };
      entry.total += 1;
      entry.correct += wasCorrect ? 1 : 0;
      byChapter.set(question.chapterId, entry);
    }

    const keyboard: InlineKeyboard = [];
    if (byChapter.size > 0) {
      lines.push("\n<b>By chapter:</b>");
      for (const [chapterId, summary] of byChapter) {
        const chapterPct = Math.round((summary.correct / summary.total) * 100);
        lines.push(`• ${escapeHtml(summary.title)}: ${summary.correct}/${summary.total} (${chapterPct}%)`);
        if (weakest === null || chapterPct < weakest.accuracy) {
          weakest = { id: chapterId, title: summary.title, accuracy: chapterPct };
        }
      }
    }

    const wrongQids = (context.wrong_qids as number[] | undefined) ?? [];
    if (wrongQids.length > 0) {
      keyboard.push([{ text: `📋 Review mistakes (${wrongQids.length})`, callback_data: "review" }]);
    }
    if (weakest && !isMistakes) {
      lines.push(`\nWeakest chapter: <b>${escapeHtml(weakest.title)}</b>`);
      keyboard.push([{ text: `Practice ${weakest.title}`, callback_data: `chapter_quiz:${weakest.id}` }]);
    }

    if (!isMistakes) {
      keyboard.push([{ text: "🔁 Try again", callback_data: "quiz_retry" }]);
    }

    if (isMistakes) {
      keyboard.push([{ text: "❌ More mistakes", callback_data: "mistakes" }]);
    }

    if (dailyLimitReached || (!(await this.isActivated()) && (await this.dailyQuestionsRemaining()) <= 0)) {
      lines.push("\n⏳ You have used your free questions for today.");
      keyboard.push([{ text: "💰 To Activate", callback_data: "activate" }]);
    }
    keyboard.push([{ text: "📊 Progress", callback_data: "progress" }]);
    keyboard.push([{ text: "🏠 Menu", callback_data: "menu" }]);

    if (!isMistakes && total > 0 && !context.score_awarded) {
      await awardQuizPoints(prisma, this.student.id, correct);
      context.score_awarded = true;
    }

    await this.send(
      this.chatId,
      `${heading}\n${escapeHtml(String(context.quiz_title ?? ""))}\nScore: <b>${correct}/${total}</b> (${pct}%)` +
        (lines.length ? `\n${lines.join("\n")}` : ""),
      keyboard,
    );
    await setSessionState(this.session, "menu", { mode: "practice", ...context });
  }

  private async retryQuestionSet(): Promise<void> {
    const context = sessionContext(this.session);
    const mode = String(context.quiz_mode ?? "chapter");
    if (mode === "chapter" && context.chapter_id) {
      await this.startPractice(Number(context.chapter_id));
      return;
    }

    const tier = Number(context.tier ?? 10);
    const ids = await this.questionPoolIds(mode, context.year != null ? Number(context.year) : null);
    const picked = ids.length ? (shuffle(ids).slice(0, tier).map((id) => ({ id }))) : [];
    await this.startQuestionSet(picked, String(context.quiz_title ?? "Practice"), mode, "practice", "practice", {
      subject_id: context.subject_id ?? null,
      subject_name: context.subject_name ?? null,
      scope: context.scope ?? "subject",
      year: context.year ?? null,
      tier: context.tier ?? 10,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Chapter tests + mock exams (spec §8, §9)                            */
  /* ------------------------------------------------------------------ */

  private async showExams(chapterId: number): Promise<void> {
    if (!(await this.requireGrade())) return;

    const mode = String(sessionContext(this.session).mode ?? "test");
    const type = mode === "mock" ? "mock" : "chapter_test";

    const chapter = chapterId ? await prisma.chapter.findUnique({ where: { id: chapterId } }) : null;
    if (!(await this.isActivated()) && (type === "mock" || (chapter !== null && chapter.requiresActivation))) {
      const context = sessionContext(this.session);
      await this.send(
        this.chatId,
        "🔒 <b>This exam requires account activation.</b>\n\nFree quizzes are available for Chapters 1–3.",
        [
          [{ text: "💰 To Activate", callback_data: "activate" }],
          [{ text: "◀️ Back to chapters", callback_data: `s:${Number(context.subject_id ?? 0)}` }],
          [{ text: "🏠 Home", callback_data: "menu" }],
        ],
      );
      return;
    }

    const exams = await prisma.exam.findMany({
      where: {
        isActive: true,
        gradeId: this.student.gradeId ?? 0,
        subjectId: Number(sessionContext(this.session).subject_id ?? 0),
        type,
        ...(type === "chapter_test"
          ? { OR: [{ chapterId }, { chapterId: null }] }
          : {}),
      },
      orderBy: { id: "asc" },
      select: { id: true, title: true },
    });

    if (exams.length === 0) {
      await this.send(
        this.chatId,
        type === "mock"
          ? "No mock exams are scheduled for this subject yet."
          : "No chapter test is available here yet.",
        await this.menuKeyboard(),
      );
      await setSessionState(this.session, "menu");
      return;
    }

    await putSessionContext(this.session, { exam_ids: exams.map((exam) => exam.id) });

    const keyboard: InlineKeyboard = [];
    for (let i = 0; i < exams.length; i += 2) {
      keyboard.push(
        exams.slice(i, i + 2).map((exam) => ({ text: `📝 ${exam.title}`, callback_data: `e:${exam.id}` })),
      );
    }
    keyboard.push([{ text: "◀️ Chapters", callback_data: `s:${Number(sessionContext(this.session).subject_id ?? 0)}` }]);

    await this.send(
      this.chatId,
      `${type === "mock" ? "🎯 <b>Mock exams</b>" : "📝 <b>Chapter tests</b>"}\nPick one 👇`,
      keyboard,
    );
    await setSessionState(this.session, "choose_exam");
  }

  private async startExam(examId: number): Promise<void> {
    if (!(await this.requireGrade())) return;

    const context = sessionContext(this.session);
    const allowed = (context.exam_ids as number[] | undefined) ?? [];

    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        isActive: true,
        gradeId: this.student.gradeId ?? 0,
      },
    });

    if (!exam || (allowed.length > 0 && !allowed.includes(examId))) {
      await this.send(this.chatId, "That exam is not available. Please pick from the list.", await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    if (!(await this.isActivated())) {
      const examChapter = exam.chapterId ? await prisma.chapter.findUnique({ where: { id: exam.chapterId } }) : null;
      if (exam.type === "mock" || !examChapter || examChapter.requiresActivation) {
        await this.send(
          this.chatId,
          "🔒 <b>This exam requires account activation.</b>\n\nFree quizzes are available for Chapters 1–3.",
          [
            [{ text: "💰 To Activate", callback_data: "activate" }],
            [{ text: "◀️ Back to chapters", callback_data: `s:${exam.subjectId}` }],
            [{ text: "🏠 Home", callback_data: "menu" }],
          ],
        );
        return;
      }
    }

    if (!(await this.isActivated()) && (await this.dailyQuestionsRemaining()) <= 0) {
      await this.showDailyLimit();
      return;
    }

    let attempt = await startAttempt(prisma, this.student, exam);

    // Free students may answer only the questions remaining in today's allowance.
    // Keep already answered questions when resuming an in-progress attempt.
    if (!(await this.isActivated())) {
      const questionIds = attemptQuestionIds(attempt as never);
      const answers = attemptAnswers(attempt as never);
      const answeredIds = Object.keys(answers).map(Number);
      const remaining = await this.dailyQuestionsRemaining();
      const cap = Math.max(answeredIds.length, Math.min(questionIds.length, answeredIds.length + remaining));
      if (cap < questionIds.length) {
        const keep = [...new Set([...answeredIds, ...questionIds.slice(0, cap)])];
        attempt = await prisma.examAttempt.update({
          where: { id: attempt.id },
          data: { questionIds: JSON.stringify(keep), totalQuestions: keep.length },
        });
      }
    }

    if (attempt.totalQuestions === 0) {
      await this.send(this.chatId, "⚠️ This exam has no questions yet. Please ask an administrator to add content.", await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    const paperIds = attemptQuestionIds(attempt as never);
    const saved = attemptAnswers(attempt as never);
    let idx = paperIds.length - 1;
    for (let i = 0; i < paperIds.length; i++) {
      if (saved[String(paperIds[i])] === undefined) {
        idx = i;
        break;
      }
      idx = i;
    }

    const examContext: SessionContext = {
      ...context,
      mode: exam.type === "mock" ? "mock" : "test",
      exam_id: exam.id,
      exam_title: exam.title,
      attempt_id: attempt.id,
      subject_id: exam.subjectId,
      chapter_id: exam.chapterId ?? context.chapter_id ?? null,
      idx: Math.min(idx, attempt.totalQuestions - 1),
      awaiting: true,
    };
    await prisma.botSession.update({
      where: { id: this.session.id },
      data: { state: "exam", context: JSON.stringify(examContext) },
    });
    this.session.state = "exam";
    this.session.context = JSON.stringify(examContext);

    await this.sendExamQuestion();
  }

  private async currentAttempt() {
    const attemptId = sessionContext(this.session).attempt_id;
    if (!attemptId) return null;
    return prisma.examAttempt.findUnique({
      where: { id: Number(attemptId) },
      include: { exam: true },
    });
  }

  private async currentExamQuestion() {
    const attempt = await this.currentAttempt();
    if (!attempt) return null;

    const qids = attemptQuestionIds(attempt);
    const idx = Number(sessionContext(this.session).idx ?? 0);
    return qids[idx] ? prisma.question.findUnique({
      where: { id: qids[idx] },
      include: { options: { orderBy: { label: "asc" } } },
    }) : null;
  }

  private async sendExamQuestion(): Promise<void> {
    const attempt = await this.currentAttempt();
    const question = await this.currentExamQuestion();

    if (!attempt || !question) {
      if (attempt) {
        await this.finishExam(attempt, attempt.exam);
      } else {
        await this.showMenu();
      }
      return;
    }

    if (examSecondsLeft(attempt) === 0) {
      await this.finishExam(await finalize(prisma, attempt), attempt.exam);
      return;
    }

    const idx = Number(sessionContext(this.session).idx ?? 0) + 1;
    const left = examSecondsLeft(attempt);
    const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

    await this.send(
      this.chatId,
      `📝 <b>${escapeHtml(String(sessionContext(this.session).exam_title ?? "Exam"))}</b>\n` +
        `Question <b>${idx}/${attempt.totalQuestions}</b> · ⏱ ${time} left\n\n` +
        `${escapeHtml(question.questionText)}\n\n${optionsText(question)}`,
      optionsKeyboard(question),
    );
    await putSessionContext(this.session, { awaiting: true });
  }

  private async answerExamQuestion(optionId: number): Promise<void> {
    const attempt = await this.currentAttempt();
    const question = await this.currentExamQuestion();

    if (!attempt || !question) {
      await this.showMenu();
      return;
    }

    if (attempt.status === "completed") {
      await this.finishExam(attempt, attempt.exam);
      return;
    }

    const option = question.options.find((candidate) => candidate.id === optionId);
    if (!option) {
      await this.sendExamQuestion();
      return;
    }

    if (examSecondsLeft(attempt) === 0) {
      await this.finishExam(await finalize(prisma, attempt), attempt.exam);
      return;
    }

    const result = await answerAttempt(prisma, attempt, attempt.exam, question.id, option.id);
    const refreshed = await prisma.examAttempt.findUnique({
      where: { id: attempt.id },
      include: { exam: true },
    });

    if (result.finished || refreshed?.status === "completed") {
      await this.finishExam(refreshed ?? attempt, attempt.exam);
      return;
    }

    const idx = Number(sessionContext(this.session).idx ?? 0) + 1;
    const answered = Object.keys(attemptAnswers(refreshed ?? attempt)).length;

    await this.send(
      this.chatId,
      `✅ Answer saved (<b>${answered}/${(refreshed ?? attempt).totalQuestions}</b>).`,
      [[{ text: "Next question ➡️", callback_data: "next" }]],
    );
    await putSessionContext(this.session, { awaiting: false, idx: idx - 1 });
  }

  private async finishExam(
    attempt: import("@prisma/client").ExamAttempt & { exam?: import("@prisma/client").Exam },
    preloadExam?: import("@prisma/client").Exam,
  ): Promise<void> {
    const exam = preloadExam ?? attempt.exam ?? (await prisma.exam.findUnique({ where: { id: attempt.examId } }));

    const answers = attemptAnswers(attempt as never);
    const wrong = Object.entries(answers)
      .filter(([, value]) => !value.correct)
      .map(([questionId]) => Number(questionId))
      .slice(0, 5);

    const context = sessionContext(this.session);
    if (attempt.status === "completed" && Number(context.scored_attempt_id ?? 0) !== attempt.id) {
      await awardQuizPoints(prisma, this.student.id, attempt.correctAnswers);
      context.scored_attempt_id = attempt.id;
    }

    const lines = [
      attempt.passed ? "🎉 <b>PASSED!</b>" : "📉 <b>Not passed</b>",
      "",
      `Exam: <b>${escapeHtml(exam?.title ?? "")}</b>`,
      `Score: <b>${attempt.score}%</b> (${attempt.correctAnswers}/${attempt.totalQuestions})`,
      `Pass mark: ${exam?.passMark ?? 0}%`,
      `⏱ Time: ${Math.floor(attempt.timeSpentSeconds / 60)}:${String(attempt.timeSpentSeconds % 60).padStart(2, "0")}`,
    ];

    if (attempt.passed && exam?.type === "chapter_test") {
      lines.push("\n✅ Great work — try the next chapter when you are ready!");
    }

    const keyboard: InlineKeyboard = [];

    if (wrong.length) {
      keyboard.push([{ text: `📋 Review mistakes (${wrong.length})`, callback_data: "review" }]);
    }

    keyboard.push([{ text: "🔁 Retry", callback_data: `retry:${attempt.examId}` }]);

    const nextChapter = exam?.chapterId ? await this.nextChapterId(exam) : null;
    if (nextChapter && exam?.type === "chapter_test") {
      keyboard.push([{ text: "⏭ Next chapter", callback_data: `c:${nextChapter}` }]);
    }

    keyboard.push([{ text: "🏠 Menu", callback_data: "menu" }]);

    const examContext: SessionContext = {
      ...context,
      exam_id: attempt.examId,
      attempt_id: attempt.id,
      wrong,
      reviewed: false,
      awaiting: false,
    };
    await prisma.botSession.update({
      where: { id: this.session.id },
      data: { state: "exam_result", context: JSON.stringify(examContext) },
    });
    this.session.state = "exam_result";
    this.session.context = JSON.stringify(examContext);

    await this.send(this.chatId, lines.join("\n"), keyboard);
  }

  private async showReview(): Promise<void> {
    const attempt = await this.currentAttempt();
    const context = sessionContext(this.session);
    const wrong = (context.wrong as number[] | undefined) ?? (context.wrong_qids as number[] | undefined) ?? [];

    if (!attempt && wrong.length > 0) {
      const questions = await prisma.question.findMany({
        where: { id: { in: wrong } },
        include: { options: { orderBy: { label: "asc" } } },
      });
      await this.startQuestionSet(questions, "Mistake review", "mistakes", "mistakes", "mistake", {
        subject_id: context.subject_id ?? null,
        subject_name: context.subject_name ?? null,
        scope: context.scope ?? "subject",
        chapter_id: context.chapter_id ?? null,
      });
      return;
    }

    if (!attempt || wrong.length === 0) {
      await this.showMenu();
      return;
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: wrong } },
      include: { options: { orderBy: { label: "asc" } } },
    });
    const byId = new Map(questions.map((question) => [question.id, question]));

    const answerss = attemptAnswers(attempt);
    for (const questionId of wrong) {
      const question = byId.get(questionId);
      if (!question) continue;

      const chosenId = answerss[String(questionId)]?.option ?? null;
      const chosen = question.options.find((candidate) => candidate.id === chosenId);
      const correct = question.options.find((candidate) => candidate.isCorrect);

      const lines = [
        `❌ <b>${escapeHtml(question.questionText)}</b>`,
        "",
        `Your answer: ${chosen ? `<s>${chosen.label}) ${escapeHtml(chosen.text)}</s>` : "—"}`,
        `Correct: <b>${correct?.label ?? "?"})</b> ${escapeHtml(correct?.text ?? "")}`,
      ];

      if (question.explanation) {
        lines.push(`\n💡 ${escapeHtml(question.explanation)}`);
      }

      await this.send(this.chatId, lines.join("\n"));
    }

    await this.send(this.chatId, "Review complete. Keep going — you have got this! 💪", [
      [{ text: "🔁 Retry", callback_data: `retry:${attempt.examId}` }],
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]);
  }

  private async nextChapterId(exam: import("@prisma/client").Exam & { chapter?: import("@prisma/client").Chapter | null }): Promise<number | null> {
    if (!exam.chapterId) return null;

    const chapter = exam.chapter ?? (await prisma.chapter.findUnique({ where: { id: exam.chapterId } }));
    const next = await prisma.chapter.findFirst({
      where: { subjectId: exam.subjectId, isActive: true, order: { gt: chapter?.order ?? 0 }, OR: [{ stream: null }, ...(this.student.stream ? [{ stream: this.student.stream }] : [])] },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    return next?.id ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Progress / announcements / settings (spec §10, §20, §25)            */
  /* ------------------------------------------------------------------ */

  private async showProgress(): Promise<void> {
    if (!(await this.requireGrade())) return;

    const { forStudent } = await import("./progress");
    const p = await forStudent(prisma, this.student);

    const lines = [
      "📊 <b>Your progress</b>",
      "",
      `Answered: <b>${p.questions_answered}</b> questions`,
      `Correct: <b>${p.correct}</b> · Wrong: <b>${p.wrong}</b>`,
      `Accuracy: <b>${p.accuracy.toFixed(1)}%</b>`,
      `Tests completed: <b>${p.tests_completed}</b>`,
      `Mock exams: <b>${p.mock_exams_completed}</b>`,
      `Open mistakes: <b>${p.open_mistakes}</b>`,
    ];

    if (p.by_subject.length > 0) {
      lines.push("\n<b>By subject:</b>");
      for (const subject of p.by_subject) {
        lines.push(`• ${escapeHtml(subject.name)}: ${subject.accuracy}% (${subject.answered} answered)`);
      }
    }

    if (p.weak_topics.length > 0) {
      lines.push("\n<b>💪 Weak areas to review:</b>");
      for (const topic of p.weak_topics) {
        lines.push(`• ${escapeHtml(topic.title)}: ${topic.accuracy}%`);
      }
    }

    await this.send(this.chatId, lines.join("\n"), [
      [{ text: "❌ My Mistakes", callback_data: "mistakes" }],
      [{ text: "✏️ Practice", callback_data: "mode:practice" }],
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]);
    await setSessionState(this.session, "menu", sessionContextRev(this.session));
  }

  private async showAnnouncements(): Promise<void> {
    const activated = await this.isActivated();
    const announcements = await prisma.announcement.findMany({
      where: {
        isPublished: true,
        OR: [
          { audience: "all" },
          { audience: "grade", gradeId: this.student.gradeId ?? 0 },
          { audience: "activated" },
        ],
        ...(activated ? {} : { audience: { not: "activated" } }),
      },
      take: 3,
      orderBy: { id: "desc" },
    });

    if (announcements.length === 0) {
      await this.send(this.chatId, "📭 No announcements right now. Check back later!", await this.menuKeyboard());
      await setSessionState(this.session, "menu");
      return;
    }

    for (let i = 0; i < announcements.length; i++) {
      const isLast = i === announcements.length - 1;
      await this.send(
        this.chatId,
        `📢 <b>${escapeHtml(announcements[i].title)}</b>\n\n${escapeHtml(announcements[i].body)}`,
        isLast ? await this.menuKeyboard() : null,
      );
    }

    await setSessionState(this.session, "menu");
  }

  private async showSettings(): Promise<void> {
    const grade = this.student.gradeId ? await prisma.grade.findUnique({ where: { id: this.student.gradeId } }) : null;

    const lines = [
      "⚙️ <b>Settings</b>",
      "",
      `Grade: <b>${grade ? escapeHtml(grade.name) : "not set"}${this.student.stream ? ` · ${escapeHtml(this.student.stream)}` : ""}</b>`,
      "Language: English (Amharic coming soon 🇪🇹)",
    ];

    await this.send(this.chatId, lines.join("\n"), [
      [{ text: "🔽 Change grade", callback_data: "grade" }],
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]);
    await setSessionState(this.session, "settings");
  }

  /* ------------------------------------------------------------------ */
  /* Presentation helpers                                                */
  /* ------------------------------------------------------------------ */

  private async send(chatId: number, text: string, keyboard: InlineKeyboard | null = null): Promise<void> {
    const chunks = splitMessage(text);
    let replyKeyboard: Array<Array<{ text: string }>> | null = null;

    if (keyboard !== null) {
      replyKeyboard = [];
      const actions: Record<string, string> = {};
      for (const row of keyboard) {
        const replyRow: Array<{ text: string }> = [];
        for (const button of row) {
          const label = String(button.text ?? "");
          if (label === "") continue;
          replyRow.push({ text: label });
          if ("callback_data" in button && button.callback_data) {
            actions[label] = String(button.callback_data);
          } else if ("url" in button && button.url) {
            actions[label] = `url:${String(button.url)}`;
          }
        }
        if (replyRow.length) replyKeyboard.push(replyRow);
      }
      await prisma.botSession.update({
        where: { id: this.session.id },
        data: { replyKeyboard: JSON.stringify(actions) },
      });
      this.session.replyKeyboard = JSON.stringify(actions);
    }

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      await this.tg.sendReplyMessage(chatId, chunks[i], isLast ? replyKeyboard : null);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Module helpers                                                      */
/* ------------------------------------------------------------------ */

function sessionContextRev(session: SessionRow): SessionContext {
  const context = sessionContext(session);
  // Reset the quiz bookkeeping so the next run starts clean.
  context.awaiting = false;
  return context;
}

function quizMetadata(session: SessionRow): SessionContext {
  const context = sessionContext(session);
  const wanted = ["subject_id", "subject_name", "chapter_id", "scope", "year", "tier"] as const;
  const metadata: SessionContext = {};
  for (const key of wanted) {
    if (context[key] !== undefined) metadata[key] = context[key];
  }
  void session;
  return metadata;
}

async function drawSample(ids: number[], size: number): Promise<Array<{ id: number }>> {
  return shuffle(ids).slice(0, Math.max(0, size)).map((id) => ({ id }));
}

function hasValidOptions(question: { options: Array<{ isCorrect: boolean }> }): boolean {
  return question.options.length >= 2 && question.options.some((option) => option.isCorrect);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function optionsText(question: { options: Array<{ label: string; text: string }> }): string {
  return question.options
    .map((option) => `<b>${option.label})</b> ${escapeHtml(option.text)}`)
    .join("\n");
}

function optionsKeyboard(question: { options: Array<{ label: string; text: string; id: number }> }): InlineKeyboard {
  const keyboard = question.options.map((option) => [
    {
      text: `${option.label}) ${option.text.trim().slice(0, 40)}`,
      callback_data: `o:${option.id}`,
    },
  ]);
  keyboard.push([{ text: "⏹ Stop quiz", callback_data: "stop" }]);
  return keyboard;
}

function displayName(student: { firstName: string | null; lastName: string | null }): string {
  return [student.firstName, student.lastName].filter(Boolean).join(" ") || "Student";
}

function amharicGrade(level: number | null): string {
  if (level === null) return "Grade";
  return `${level}ኛ ክፍል`;
}

function gradeButtonRows(grades: Array<{ id: number; name: string; level: number }>): InlineKeyboard {
  const rows: InlineKeyboard = [];
  let regularButtons: Array<{ text: string; callback_data: string }> = [];
  for (const grade of grades) {
    if (grade.level === 12) {
      if (regularButtons.length) rows.push(regularButtons);
      regularButtons = [];
      rows.push([
        { text: "Natural · Grade 12", callback_data: `g:${grade.id}:natural` },
        { text: "Social · Grade 12", callback_data: `g:${grade.id}:social` },
      ]);
      continue;
    }
    regularButtons.push({
      text: `${grade.name.trim() || `Grade ${grade.level}`} · ${amharicGrade(grade.level)}`,
      callback_data: `g:${grade.id}`,
    });
    if (regularButtons.length === 2) {
      rows.push(regularButtons);
      regularButtons = [];
    }
  }
  if (regularButtons.length) rows.push(regularButtons);
  return rows;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ltrimAt(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

/** Split >4000-char messages on line boundaries. */
function splitMessage(text: string): string[] {
  if (text.length <= 4000) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > 4000) {
      chunks.push(current);
      current = "";
    }
    current += (current === "" ? "" : "\n") + line;
  }

  if (current !== "") chunks.push(current);

  return chunks.length ? chunks : [text];
}

// Re-exported for the webhook route and smoke scripts.
export { jsonify, parseJson, isoWeekId };
