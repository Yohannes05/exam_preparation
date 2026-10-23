/**
 * Port of backend/app/Services/ProgressService.php.
 *
 * Records answers, aggregates progress (spec §10) and manages the
 * My Mistakes area (spec §11).
 */

import { prisma as defaultDb } from "./db";
import type { PrismaClient } from "@prisma/client";
import { isoWeekId } from "./time";

export type StudentRow = { id: number; gradeId: number | null };

/** Persist one answered question and update the mistake book. */
export async function recordAnswer(
  db: PrismaClient,
  student: StudentRow,
  question: { id: number },
  chosenOptionId: number | null,
  correct: boolean,
  context: "practice" | "test" | "mock" | "mistake" = "practice",
  examAttemptId: number | null = null,
): Promise<void> {
  await db.questionAttempt.create({
    data: {
      studentId: student.id,
      questionId: question.id,
      examAttemptId,
      context,
      chosenOptionId,
      isCorrect: correct,
      answeredAt: new Date(),
    },
  });

  await updateMistakeBook(db, student, question.id, correct, context);

  await db.student.update({
    where: { id: student.id },
    data: { lastSeenAt: new Date() },
  });
}

async function updateMistakeBook(
  db: PrismaClient,
  student: StudentRow,
  questionId: number,
  correct: boolean,
  context: string,
): Promise<void> {
  const existing = await db.mistake.findUnique({
    where: { studentId_questionId: { studentId: student.id, questionId } },
  });

  if (correct) {
    if (existing) {
      await db.mistake.update({
        where: { id: existing.id },
        data: {
          rightCount: { increment: 1 },
          // Answered correctly while reviewing → mastered.
          isMastered: existing.isMastered || context === "mistake",
        },
      });
    }
    return;
  }

  await db.mistake.upsert({
    where: { studentId_questionId: { studentId: student.id, questionId } },
    create: { studentId: student.id, questionId, wrongCount: 1 },
    update: {
      wrongCount: { increment: existing ? 1 : 0 },
      isMastered: false,
      lastWrongAt: new Date(),
    },
  });
}

/** Full progress snapshot for a student (spec §10). */
export async function forStudent(db: PrismaClient, student: StudentRow) {
  const answered = await db.questionAttempt.count({ where: { studentId: student.id } });
  const correct = await db.questionAttempt.count({
    where: { studentId: student.id, isCorrect: true },
  });

  const [testsCompleted, mocksCompleted] = await Promise.all([
    db.examAttempt.count({
      where: {
        studentId: student.id,
        status: "completed",
        exam: { type: "chapter_test" },
      },
    }),
    db.examAttempt.count({
      where: {
        studentId: student.id,
        status: "completed",
        exam: { type: "mock" },
      },
    }),
  ]);

  const openMistakes = await db.mistake.count({
    where: { studentId: student.id, isMastered: false },
  });

  return {
    questions_answered: answered,
    correct,
    wrong: answered - correct,
    accuracy: answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0,
    tests_completed: testsCompleted,
    mock_exams_completed: mocksCompleted,
    open_mistakes: openMistakes,
    by_subject: await aggregateBy(db, student.id, "subject"),
    by_chapter: await aggregateBy(db, student.id, "chapter"),
    weak_topics: await weakTopics(db, student.id),
  };
}

async function aggregateBy(
  db: PrismaClient,
  studentId: number,
  relation: "subject" | "chapter",
): Promise<Array<{ id: number; name: string; answered: number; correct: number; accuracy: number }>> {
  const attempts = await db.questionAttempt.findMany({
    where: { studentId },
    select: { isCorrect: true, question: { select: { subjectId: true, chapterId: true } } },
  });

  const counts = new Map<number, { name: string; answered: number; correct: number }>();
  for (const attempt of attempts) {
    const relatedId = attempt.question[relation === "subject" ? "subjectId" : "chapterId"];
    if (relatedId == null) continue;
    const current = counts.get(relatedId) ?? { name: "", answered: 0, correct: 0 };
    current.name = "";
    current.answered += 1;
    if (attempt.isCorrect) current.correct += 1;
    counts.set(relatedId, current);
  }

  // Labels need the related table; fetch them in one query each.
  const ids = [...counts.keys()];
  const labels = new Map<number, string>();
  if (ids.length) {
    const rows =
      relation === "subject"
        ? await db.subject.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : await db.chapter.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
    for (const row of rows) labels.set(row.id, (row as { name?: string; title?: string }).name ?? (row as { title?: string }).title ?? "");
  }

  return [...counts.entries()]
    .map(([id, value]) => ({
      id,
      name: labels.get(id) ?? "",
      answered: value.answered,
      correct: value.correct,
      accuracy: Math.round((value.correct / Math.max(1, value.answered)) * 1000) / 10,
    }))
    .sort((a, b) => b.answered - a.answered);
}

/** Topics with the lowest accuracy, min 2 attempts. */
export async function weakTopics(
  db: PrismaClient,
  studentId: number,
): Promise<Array<{ id: number; title: string; answered: number; accuracy: number }>> {
  const attempts = await db.questionAttempt.findMany({
    where: { studentId, question: { topicId: { not: null } } },
    select: { isCorrect: true, question: { select: { topicId: true } } },
  });

  const counts = new Map<number, { answered: number; correct: number }>();
  for (const attempt of attempts) {
    const topicId = attempt.question.topicId;
    if (topicId == null) continue;
    const current = counts.get(topicId) ?? { answered: 0, correct: 0 };
    current.answered += 1;
    if (attempt.isCorrect) current.correct += 1;
    counts.set(topicId, current);
  }

  const eligible = [...counts.entries()].filter(([, value]) => value.answered >= 2);
  const ids = eligible.map(([id]) => id);
  const titles = new Map<number, string>();
  if (ids.length) {
    const rows = await db.topic.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
    for (const row of rows) titles.set(row.id, row.title);
  }

  return eligible
    .map(([id, value]) => ({
      id,
      title: titles.get(id) ?? "",
      answered: value.answered,
      accuracy: Math.round((value.correct / value.answered) * 1000) / 10,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);
}

/** Unmastered mistakes with full question payload for review practice. */
export async function mistakes(db: PrismaClient, studentId: number, limit = 20) {
  return db.mistake.findMany({
    where: { studentId, isMastered: false },
    include: {
      question: { include: { options: { orderBy: { label: "asc" } }, chapter: true, subject: true } },
    },
    orderBy: { lastWrongAt: "desc" },
    take: limit,
  });
}

/** Award one point per correct answer to the weekly and lifetime totals. */
export async function awardQuizPoints(db: PrismaClient, studentId: number, points: number): Promise<void> {
  if (points <= 0) return;

  const weekId = isoWeekId();
  await db.score.upsert({
    where: { studentId_weekId: { studentId, weekId } },
    create: { studentId, weekId, weeklyPoints: 0, totalPoints: 0 },
    update: {},
  });
  await db.score.update({
    where: { studentId_weekId: { studentId, weekId } },
    data: {
      weeklyPoints: { increment: points },
      totalPoints: { increment: points },
    },
  });
}

export async function weeklyScore(db: PrismaClient, studentId: number): Promise<number> {
  const sum = await db.score.aggregate({
    where: { studentId, weekId: isoWeekId() },
    _sum: { weeklyPoints: true },
  });
  return sum._sum.weeklyPoints ?? 0;
}

export async function allTimeScore(db: PrismaClient, studentId: number): Promise<number> {
  const sum = await db.score.aggregate({
    where: { studentId },
    _sum: { totalPoints: true },
  });
  return sum._sum.totalPoints ?? 0;
}

/** Rank of the student among students in their grade by weekly points. */
export async function weeklyRank(db: PrismaClient, student: StudentRow): Promise<number | null> {
  return rankOf(db, student, true);
}

/** Rank of the student among students in their grade by lifetime points. */
export async function allTimeRank(db: PrismaClient, student: StudentRow): Promise<number | null> {
  return rankOf(db, student, false);
}

/** Competition rank: one plus the number of classmates with higher points. */
async function rankOf(db: PrismaClient, student: StudentRow, weekly: boolean): Promise<number | null> {
  if (!student.gradeId) return null;

  const classmates = await db.student.findMany({
    where: { gradeId: student.gradeId },
    select: { id: true, scores: { select: { weeklyPoints: true, totalPoints: true } } },
  });

  const pointsFor = (rows: Array<{ weeklyPoints: number; totalPoints: number }>) =>
    rows.reduce((sum, row) => sum + (weekly ? row.weeklyPoints : row.totalPoints), 0);

  const points = new Map<number, number>();
  for (const classmate of classmates) {
    points.set(classmate.id, pointsFor(classmate.scores));
  }

  const studentPoints = points.get(student.id) ?? 0;
  if (studentPoints === 0) return null;

  let rank = 1;
  for (const value of points.values()) {
    if (value > studentPoints) rank += 1;
  }
  return rank;
}

// Default instance convenience for callers that use the shared client.
export const progress = {
  recordAnswer: (
    student: StudentRow,
    question: { id: number },
    chosenOptionId: number | null,
    correct: boolean,
    context?: "practice" | "test" | "mock" | "mistake",
    examAttemptId?: number | null,
  ) =>
    recordAnswer(defaultDb, student, question, chosenOptionId, correct, context, examAttemptId),
  forStudent: (student: StudentRow) => forStudent(defaultDb, student),
  mistakes: (studentId: number, limit?: number) => mistakes(defaultDb, studentId, limit),
  awardQuizPoints: (studentId: number, points: number) => awardQuizPoints(defaultDb, studentId, points),
};
