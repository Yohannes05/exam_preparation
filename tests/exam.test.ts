import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  attemptAnswers,
  attemptQuestionIds,
  buildPaper,
  examSecondsLeft,
  finalize,
  type ExamAttemptRow,
  type ExamRow,
} from "../src/lib/exam";

const exam: ExamRow = {
  id: 7,
  type: "chapter_test",
  gradeId: 12,
  subjectId: 4,
  chapterId: 9,
  questionCount: 3,
  timeLimitMinutes: 20,
  passMark: 60,
  distribution: null,
};

function dbWith(questions: Array<{ id: number; difficulty: string }>, pins: Array<{ question: { id: number } }> = []) {
  return {
    examQuestion: {
      findMany: async () => pins,
    },
    question: {
      findMany: async () => questions,
    },
  } as unknown as PrismaClient;
}

test("buildPaper honors pinned question order and question limit", async () => {
  const db = dbWith([], [
    { question: { id: 20 } },
    { question: { id: 10 } },
    { question: { id: 30 } },
    { question: { id: 40 } },
  ]);

  assert.deepEqual(await buildPaper(db, exam), [{ id: 20 }, { id: 10 }, { id: 30 }]);
});

test("buildPaper selects unique questions and follows difficulty distribution", async () => {
  const distributedExam = {
    ...exam,
    distribution: JSON.stringify({ difficulties: { easy: 1, medium: 1, hard: 1 } }),
  };
  const questions = [
    { id: 1, difficulty: "easy" },
    { id: 2, difficulty: "easy" },
    { id: 3, difficulty: "medium" },
    { id: 4, difficulty: "hard" },
  ];

  const paper = await buildPaper(dbWith(questions), distributedExam);
  const ids = paper.map(({ id }) => id);

  assert.equal(paper.length, exam.questionCount);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => questions.find((q) => q.id === id)?.difficulty === "easy").length, 1);
  assert.equal(ids.filter((id) => questions.find((q) => q.id === id)?.difficulty === "medium").length, 1);
  assert.equal(ids.filter((id) => questions.find((q) => q.id === id)?.difficulty === "hard").length, 1);
});

test("attempt helpers safely read saved answers and question IDs", () => {
  const attempt = {
    answers: JSON.stringify({ "11": { option: 42, correct: true } }),
    questionIds: "[11,12]",
  } as ExamAttemptRow;

  assert.deepEqual(attemptAnswers(attempt), { "11": { option: 42, correct: true } });
  assert.deepEqual(attemptQuestionIds(attempt), [11, 12]);
  assert.deepEqual(attemptAnswers({ ...attempt, answers: "invalid" }), {});
  assert.deepEqual(attemptQuestionIds({ ...attempt, questionIds: null }), []);
});

test("examSecondsLeft returns zero for completed attempts and expired clocks", () => {
  const attempt = {
    status: "in_progress",
    expiresAt: new Date(Date.now() + 60_000),
  } as ExamAttemptRow;
  assert.ok(examSecondsLeft(attempt) > 0);
  assert.equal(examSecondsLeft({ ...attempt, status: "completed" }), 0);
  assert.equal(examSecondsLeft({ ...attempt, expiresAt: new Date(Date.now() - 1_000) }), 0);
  assert.equal(examSecondsLeft({ ...attempt, expiresAt: null }), 0);
});

test("finalize calculates the percentage, pass mark, and completed status", async () => {
  const attempt = {
    id: 5,
    status: "in_progress",
    totalQuestions: 3,
    correctAnswers: 0,
    score: 0,
    passed: false,
    startedAt: new Date(Date.now() - 5_000),
    answers: JSON.stringify({
      "1": { option: 1, correct: true },
      "2": { option: 2, correct: false },
      "3": { option: 3, correct: true },
    }),
    exam: { passMark: 60 },
  };
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    examAttempt: {
      findUnique: async () => attempt,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...attempt, ...data };
      },
    },
  } as unknown as PrismaClient;

  const result = await finalize(db, attempt as unknown as ExamAttemptRow);
  const updated = updates[0];

  assert.equal(updated.status, "completed");
  assert.equal(updated.correctAnswers, 2);
  assert.equal(updated.score, 67);
  assert.equal(updated.passed, true);
  assert.ok(Number(updated.timeSpentSeconds) >= 0);
  assert.equal(result.score, 67);
});
