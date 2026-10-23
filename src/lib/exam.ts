/**
 * Port of backend/app/Services/ExamService.php.
 *
 * Chapter tests (spec §8) and mock examinations (spec §9):
 * builds papers, tracks time limits, scores and finalizes attempts.
 */

import type { PrismaClient } from "@prisma/client";
import { secondsLeft as secondsLeftClock } from "./time";
import { recordAnswer } from "./progress";
import { parseJson } from "./serialize";
import { ApiError } from "./auth";

export type ExamRow = {
  id: number;
  type: string; // chapter_test | mock
  gradeId: number;
  subjectId: number;
  chapterId: number | null;
  questionCount: number;
  timeLimitMinutes: number;
  passMark: number;
  distribution: string | null;
};

export type ExamAttemptRow = {
  id: number;
  examId: number;
  studentId: number;
  status: string; // in_progress | completed
  startedAt: Date | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  totalQuestions: number;
  correctAnswers: number;
  score: number;
  answers: string | null;
  questionIds: string | null;
  passed: boolean;
  timeSpentSeconds: number;
};

export type StudentRef = { id: number; gradeId: number | null };

export function attemptAnswers(attempt: ExamAttemptRow): Record<string, { option: number; correct: boolean }> {
  return parseJson(attempt.answers, {} as Record<string, { option: number; correct: boolean }>);
}

export function attemptQuestionIds(attempt: ExamAttemptRow): number[] {
  return parseJson(attempt.questionIds, [] as number[]);
}

/** Questions eligible for an exam, respecting chapter config. */
export async function eligibleQuestions(db: PrismaClient, exam: ExamRow) {
  return db.question.findMany({
    where: {
      isActive: true,
      gradeId: exam.gradeId,
      subjectId: exam.subjectId,
      ...(exam.chapterId ? { chapterId: exam.chapterId } : {}),
    },
    include: { options: { orderBy: { label: "asc" } } },
  });
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Build the ordered paper: pinned questions, else draw per config. */
export async function buildPaper(
  db: PrismaClient,
  exam: ExamRow,
): Promise<Array<{ id: number }>> {
  const pins = await db.examQuestion.findMany({
    where: { examId: exam.id },
    include: { question: { include: { options: { orderBy: { label: "asc" } } } } },
    orderBy: { position: "asc" },
  });

  if (pins.length > 0) {
    return pins.slice(0, exam.questionCount).map((pin) => pin.question);
  }

  const pool = shuffle(await eligibleQuestions(db, exam));
  const distribution = (parseJson<{ difficulties?: Record<string, number> }>(exam.distribution, {}) ?? {}) as {
    difficulties?: Record<string, number>;
  };

  // Difficulty distribution: {"easy": 3, "medium": 5, "hard": 2}
  if (distribution.difficulties && Object.keys(distribution.difficulties).length > 0) {
    const selected: Array<{ id: number; difficulty: string }> = [];
    const chosen = new Set<number>();

    for (const [difficulty, count] of Object.entries(distribution.difficulties)) {
      for (const question of pool) {
        if (selected.length >= exam.questionCount) break;
        if (
          question.difficulty === difficulty &&
          !chosen.has(question.id) &&
          selected.filter((q) => q.difficulty === difficulty).length < Number(count)
        ) {
          selected.push(question);
          chosen.add(question.id);
        }
      }
    }

    const remaining = exam.questionCount - selected.length;
    for (const question of pool) {
      if (remaining <= 0 || selected.length >= exam.questionCount) break;
      if (!chosen.has(question.id)) {
        selected.push(question);
        chosen.add(question.id);
      }
    }

    return selected.slice(0, exam.questionCount);
  }

  return pool.slice(0, exam.questionCount);
}

/** Start (or resume) an attempt for a student. */
export async function startAttempt(db: PrismaClient, student: StudentRef, exam: ExamRow) {
  let attempt = await db.examAttempt.findFirst({
    where: { studentId: student.id, examId: exam.id, status: "in_progress" },
  });

  if (attempt && attempt.expiresAt && attempt.expiresAt.getTime() <= Date.now()) {
    await finalize(db, attempt);
    attempt = null;
  }

  if (attempt) return attempt;

  const paper = await buildPaper(db, exam);

  return db.examAttempt.create({
    data: {
      examId: exam.id,
      studentId: student.id,
      status: "in_progress",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + exam.timeLimitMinutes * 60_000),
      totalQuestions: paper.length,
      questionIds: JSON.stringify(paper.map((question) => question.id)),
      answers: "{}",
    },
  });
}

/** Remaining seconds on the clock (0 when finished/expired). */
export function examSecondsLeft(attempt: ExamAttemptRow): number {
  if (attempt.status === "completed" || !attempt.expiresAt) return 0;
  return secondsLeftClock(attempt.expiresAt);
}

/**
 * Answer one question of an attempt. Returns
 * { correct, correctOptionId, finished }.
 */
export async function answer(
  db: PrismaClient,
  attempt: ExamAttemptRow,
  exam: ExamRow,
  questionId: number,
  optionId: number,
): Promise<{ correct: boolean; correctOptionId: number | null; finished: boolean }> {
  if (attempt.status === "completed") {
    throw new ApiError(422, "This attempt is already finished.");
  }

  const question = await db.question.findUnique({
    where: { id: questionId },
    include: { options: { orderBy: { label: "asc" } } },
  });
  if (!question) throw new ApiError(422, "Question not found.");

  const option = question.options.find((candidate) => candidate.id === optionId);
  if (!option) throw new ApiError(422, "Invalid option for this question.");

  const paperIds = attemptQuestionIds(attempt);
  if (!paperIds.includes(questionId)) {
    throw new ApiError(422, "Question is not part of this attempt.");
  }

  const correct = Boolean(option.isCorrect);

  const answers = attemptAnswers(attempt);
  answers[String(questionId)] = { option: optionId, correct };
  await db.examAttempt.update({
    where: { id: attempt.id },
    data: { answers: JSON.stringify(answers) },
  });

  const student = await db.student.findUnique({
    where: { id: attempt.studentId },
    select: { id: true, gradeId: true },
  });
  if (student) {
    await recordAnswer(
      db,
      student,
      question,
      optionId,
      correct,
      exam.type === "mock" ? "mock" : "test",
      attempt.id,
    );
  }

  const finished =
    Object.keys(answers).length >= Math.max(1, attempt.totalQuestions) ||
    examSecondsLeft(attempt) === 0;

  if (finished) {
    await finalize(db, {
      ...attempt,
      answers: JSON.stringify(answers),
    });
  }

  return {
    correct,
    correctOptionId: question.options.find((candidate) => candidate.isCorrect)?.id ?? null,
    finished,
  };
}

/** Score and close an attempt (auto-called on last answer or timeout). */
export async function finalize(db: PrismaClient, attemptRow: ExamAttemptRow) {
  if (attemptRow.status === "completed") return attemptRow;

  const full = await db.examAttempt.findUnique({
    where: { id: attemptRow.id },
    include: { exam: true },
  });
  if (!full || full.status === "completed") return full ?? attemptRow;

  const answers = attemptAnswers(full);
  const total = Math.max(1, full.totalQuestions);
  const correct = Object.values(answers).filter((value) => value.correct).length;
  const score = Math.round((correct / total) * 100);

  return db.examAttempt.update({
    where: { id: full.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      correctAnswers: correct,
      score,
      passed: score >= full.exam.passMark,
      timeSpentSeconds: full.startedAt
        ? Math.max(0, Math.floor((Date.now() - full.startedAt.getTime()) / 1000))
        : 0,
    },
  });
}
