import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { jsonify } from "@/lib/serialize";

/** GET /api/dashboard — headline stats (spec §19, Admin Analytics). */
export async function GET() {
  try {
    await requireAdmin();

    const [
      totalAnswered,
      totalCorrect,
      mockCompleted,
      testsCompleted,
      studentsTotal,
      studentsActive,
      studentsActivated,
      studentsNewWeek,
      referralsTotal,
      referralsQualified,
      questionsTotal,
      announcementsTotal,
    ] = await Promise.all([
      prisma.questionAttempt.count(),
      prisma.questionAttempt.count({ where: { isCorrect: true } }),
      prisma.examAttempt.count({ where: { status: "completed", exam: { type: "mock" } } }),
      prisma.examAttempt.count({
        where: { status: "completed", exam: { type: "chapter_test" } },
      }),
      prisma.student.count(),
      prisma.student.count({ where: { isActive: true } }),
      prisma.student.count({ where: { activatedUntil: { gt: new Date() } } }),
      prisma.student.count({ where: { joinedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      prisma.referral.count(),
      prisma.referral.count({ where: { qualifiedAt: { not: null } } }),
      prisma.question.count(),
      prisma.announcement.count(),
    ]);

    const [gradesTotal, gradesAvailable] = await Promise.all([
      prisma.grade.count(),
      prisma.grade.count({ where: { isActive: true } }),
    ]);

    const [subjectsTotal, subjectsAvailable] = await Promise.all([
      prisma.subject.count(),
      prisma.subject.count({ where: { isActive: true, grade: { isActive: true } } }),
    ]);

    const [chaptersTotal, chaptersAvailable] = await Promise.all([
      prisma.chapter.count(),
      prisma.chapter.count({ where: { isActive: true, subject: { isActive: true, grade: { isActive: true } } } }),
    ]);

    const [notesTotal, notesAvailable] = await Promise.all([
      prisma.note.count(),
      prisma.note.count({
        where: {
          grade: { isActive: true },
          chapter: { isActive: true, subject: { isActive: true } },
        },
      }),
    ]);

    const [questionsAvailable, topicsTotal, topicsAvailable] = await Promise.all([
      prisma.question.count({
        where: {
          isActive: true,
          grade: { isActive: true },
          subject: { isActive: true },
          chapter: { isActive: true },
          options: { some: { isCorrect: true } },
        },
      }),
      prisma.topic.count(),
      prisma.topic.count({
        where: { chapter: { isActive: true, subject: { isActive: true } } },
      }),
    ]);

    const [examsTotal, examsAvailable] = await Promise.all([
      prisma.exam.count(),
      prisma.exam.count({ where: { isActive: true } }),
    ]);

    const completedAttempts = await prisma.examAttempt.count({ where: { status: "completed" } });

    return NextResponse.json({
      students: {
        total: studentsTotal,
        active: studentsActive,
        activated: studentsActivated,
        new_this_week: studentsNewWeek,
      },
      referrals: {
        total: referralsTotal,
        qualified: referralsQualified,
      },
      content: {
        questions: questionsTotal,
        announcements: announcementsTotal,
      },
      inventory: {
        grades: {
          total: gradesTotal,
          available: gradesAvailable,
          description: "Visible grade choices in Telegram",
        },
        subjects: {
          total: subjectsTotal,
          available: subjectsAvailable,
          description: "Active subjects under visible grades",
        },
        chapters: {
          total: chaptersTotal,
          available: chaptersAvailable,
          description: "Active chapters under visible subjects",
        },
        notes: {
          total: notesTotal,
          available: notesAvailable,
          description: "Notes reachable from active chapters",
        },
        questions: {
          total: questionsTotal,
          available: questionsAvailable,
          description: "Active questions with answer choices",
        },
        topics: {
          total: topicsTotal,
          available: topicsAvailable,
          description: "Optional topic labels under active chapters",
        },
        exams: {
          total: examsTotal,
          available: examsAvailable,
          description: "Active records; not linked to current Telegram menus",
        },
        students: {
          total: studentsTotal,
          available: studentsActive,
          description: "Registered Telegram students",
        },
        results: {
          total: completedAttempts,
          available: completedAttempts,
          description: "Completed exam attempts in Results",
        },
      },
      activity: {
        questions_answered: totalAnswered,
        accuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 1000) / 10 : 0,
        mock_exams_completed: mockCompleted,
        chapter_tests_completed: testsCompleted,
      },
      popular_subjects: jsonify(await popularSubjects()),
      difficult_questions: jsonify(await difficultQuestions()),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Subjects ranked by number of answered questions (spec §19). */
async function popularSubjects(): Promise<
  Array<{ id: number; name: string; answers: number; accuracy: number }>
> {
  const rows = await prisma.questionAttempt.findMany({
    select: { isCorrect: true, question: { select: { subjectId: true, subject: { select: { name: true } } } } },
  });

  const counts = new Map<number, { id: number; name: string; answers: number; correct: number }>();
  for (const row of rows) {
    const key = row.question.subjectId;
    const current = counts.get(key) ?? {
      id: row.question.subjectId,
      name: row.question.subject.name,
      answers: 0,
      correct: 0,
    };
    current.answers += 1;
    if (row.isCorrect) current.correct += 1;
    counts.set(key, current);
  }

  return [...counts.values()]
    .map((value) => ({
      id: value.id,
      name: value.name,
      answers: value.answers,
      accuracy: Math.round((value.correct / Math.max(1, value.answers)) * 1000) / 10,
    }))
    .sort((a, b) => b.answers - a.answers)
    .slice(0, 7);
}

/** Questions with the lowest correct rate, min 3 attempts (spec §19). */
async function difficultQuestions(): Promise<
  Array<{ id: number; question_text: string; attempts: number; accuracy: number }>
> {
  const rows = await prisma.questionAttempt.findMany({
    select: {
      isCorrect: true,
      question: { select: { id: true, questionText: true } },
    },
  });

  const counts = new Map<number, { id: number; question_text: string; attempts: number; correct: number }>();
  for (const row of rows) {
    const key = row.question.id;
    const current = counts.get(key) ?? {
      id: row.question.id,
      question_text: row.question.questionText,
      attempts: 0,
      correct: 0,
    };
    current.attempts += 1;
    if (row.isCorrect) current.correct += 1;
    counts.set(key, current);
  }

  return [...counts.values()]
    .filter((value) => value.attempts >= 3)
    .map((value) => ({
      id: value.id,
      question_text: value.question_text,
      attempts: value.attempts,
      accuracy: Math.round((value.correct / value.attempts) * 1000) / 10,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 7);
}
