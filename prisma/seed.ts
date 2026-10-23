import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const grade = await prisma.grade.create({
    data: { name: "Grade 12", level: 12, description: "Grade 12 exit exam track" },
  });

  const subject = await prisma.subject.create({
    data: { gradeId: grade.id, name: "Mathematics", language: "en" },
  });

  const chapter = await prisma.chapter.create({
    data: {
      subjectId: subject.id,
      title: "Chapter 1: Relations and Functions",
      order: 1,
    },
  });

  await prisma.note.create({
    data: {
      gradeId: grade.id,
      subjectId: subject.id,
      chapterId: chapter.id,
      title: "Relations and Functions — Quick Notes",
      content:
        "A relation maps inputs to outputs.\n" +
        "A function maps every input to exactly one output.\n" +
        "Domain: allowed inputs. Range: achievable outputs.",
    },
  });

  const questionSeeds = [
    { text: "What is the domain of f(x) = 1/(x - 2)?", correct: "x ≠ 2", difficulty: "easy" },
    { text: "If f(x) = 2x + 1, what is f(3)?", correct: "7", difficulty: "easy" },
    { text: "Which relation is a function?", correct: "[(1,2),(2,3),(3,4)]", difficulty: "medium" },
    { text: "Range of f(x) = x² ?", correct: "[0, ∞)", difficulty: "medium" },
    { text: "If f(x)=x and g(x)=f(x)+2, then g(x) = ?", correct: "x + 2", difficulty: "hard" },
  ];

  for (const seed of questionSeeds) {
    await prisma.question.create({
      data: {
        gradeId: grade.id,
        subjectId: subject.id,
        chapterId: chapter.id,
        questionText: seed.text,
        difficulty: seed.difficulty,
        explanation: "See Chapter 1 notes.",
        isActive: true,
        options: {
          create: [
            { label: "A", text: seed.correct, isCorrect: true },
            { label: "B", text: "Option B (wrong)", isCorrect: false },
            { label: "C", text: "Option C (wrong)", isCorrect: false },
            { label: "D", text: "Option D (wrong)", isCorrect: false },
          ],
        },
      },
    });
  }

  await prisma.exam.create({
    data: {
      type: "chapter_test",
      gradeId: grade.id,
      subjectId: subject.id,
      chapterId: chapter.id,
      title: "Chapter 1 Test",
      questionCount: 5,
      timeLimitMinutes: 15,
      passMark: 60,
    },
  });

  await prisma.exam.create({
    data: {
      type: "mock",
      gradeId: grade.id,
      subjectId: subject.id,
      title: "Mathematics Mock Exam",
      questionCount: 5,
      timeLimitMinutes: 30,
      passMark: 50,
    },
  });

  await prisma.announcement.create({
    data: {
      title: "Welcome 👋",
      body: "This bot is live. Take the Chapter 1 test to get started!",
      isPublished: true,
      publishedAt: new Date(),
    },
  });

  await prisma.student.create({
    data: {
      telegramId: 123456789,
      firstName: "Demo",
      lastName: "Student",
      gradeId: grade.id,
      isActive: true,
      joinedAt: new Date(),
    },
  });

  console.log("Seed complete: grade 12, math subject, 1 chapter, 5 questions, 2 exams.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
