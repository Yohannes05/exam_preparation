import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCES } from "../src/lib/resources";

test("question creation accepts an omitted or blank chapter", () => {
  const question = {
    grade_id: 1,
    subject_id: 2,
    question_text: "What is 2 + 2?",
    question_type: "multiple_choice",
    difficulty: "easy",
    options: [
      { label: "A", text: "4", is_correct: true },
      { label: "B", text: "5", is_correct: false },
    ],
  };

  assert.equal(RESOURCES.questions.create.safeParse(question).success, true);
  assert.equal(RESOURCES.questions.create.safeParse({ ...question, chapter_id: null }).success, true);
});
