"use client";

import { useEffect, useState } from "react";

type AttemptRow = {
  id: number;
  exam: { title: string; type: string; grade?: { name: string }; subject?: { name: string } };
  student: { firstName: string | null; lastName: string | null };
  score: number;
  passed: boolean;
  correctAnswers: number;
  totalQuestions: number;
  completedAt: string | null;
};

type Breakdown = {
  question: { id: number; question_text: string; difficulty: string; explanation: string | null };
  chosen_option_id: number | null;
  is_correct: boolean;
  options: Array<{ id: number; label: string; text: string; is_correct: boolean }>;
};
type PracticeRow = {
  id: number;
  answeredAt: string;
  isCorrect: boolean;
  student: { firstName: string | null; lastName: string | null; telegramUsername: string | null };
  question: { questionText: string; chapter?: { title: string } | null; subject?: { name: string } | null };
  chosenOption?: { label: string; text: string } | null;
};

export default function ResultsPage() {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [breakdown, setBreakdown] = useState<Array<Breakdown> | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [practice, setPractice] = useState<PracticeRow[]>([]);
  const [examType, setExamType] = useState("");

  async function load() {
    const response = await fetch(`/api/results?per_page=50${examType ? `&type=${examType}` : ""}`, { credentials: "same-origin" });
    const body = (await response.json().catch(() => ({ data: [] }))) as { data?: AttemptRow[] };
    setRows(body.data ?? []);
    const practiceResponse = await fetch("/api/results/practice?per_page=50", { credentials: "same-origin" });
    const practiceBody = await practiceResponse.json().catch(() => ({ data: [] })) as { data?: PracticeRow[] };
    setPractice(practiceBody.data ?? []);
  }

  useEffect(() => {
    load();
  }, [examType]);

  async function open(id: number) {
    const response = await fetch(`/api/results/${id}`, { credentials: "same-origin" });
    if (response.ok) {
      const body = (await response.json()) as { breakdown: Array<Breakdown> };
      setOpenId(id);
      setBreakdown(body.breakdown);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"><select aria-label="Filter exam type" value={examType} onChange={(event) => setExamType(event.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm"><option value="">All exam types</option><option value="chapter_test">Chapter tests</option><option value="mock">Mock exams</option></select><span className="text-xs text-slate-500">{rows.length} attempts</span></div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Attempt</th>
              <th className="px-4 py-2">Exam</th>
              <th className="px-4 py-2">Student</th>
              <th className="px-4 py-2">Score</th>
              <th className="px-4 py-2">Passed</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-2">#{row.id}</td>
                <td className="px-4 py-2">
                  {row.exam.title}
                  <span className="ml-1 text-xs text-slate-400">({row.exam.type})</span>
                </td>
                <td className="px-4 py-2">
                  {row.student.firstName ?? "—"} {row.student.lastName ?? ""}
                </td>
                <td className="px-4 py-2">
                  {row.correctAnswers}/{row.totalQuestions} ({row.score}%)
                </td>
                <td className="px-4 py-2">{row.passed ? "✅" : "❌"}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => open(row.id)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                  >
                    Breakdown
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No completed attempts.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {openId !== null && breakdown ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setOpenId(null); setBreakdown(null); } }}>
        <div role="dialog" aria-modal="true" aria-labelledby="attempt-breakdown-title" className="max-h-[90vh] w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
          <div className="flex items-start justify-between">
            <h2 id="attempt-breakdown-title" className="text-lg font-semibold">Attempt #{openId} breakdown</h2>
            <button
              onClick={() => {
                setOpenId(null);
                setBreakdown(null);
              }}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <ol className="space-y-3 text-sm">
            {breakdown.map((entry) => (
              <li key={entry.question.id} className="rounded border border-slate-100 p-3">
                <p className="font-medium">{entry.question.question_text}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {entry.is_correct ? "✅ Correct" : "❌ Not correct"} · Difficulty {entry.question.difficulty}
                </p>
                <ul className="mt-2 space-y-1">{entry.options.map((option) => {
                  const chosen = entry.chosen_option_id === option.id;
                  return <li key={option.id} className={`rounded px-2 py-1 ${option.is_correct ? "bg-emerald-50 text-emerald-800" : chosen ? "bg-rose-50 text-rose-800" : "text-slate-500"}`}>
                    {option.label}) {option.text}{option.is_correct ? " · Correct answer" : ""}{chosen ? " · Student answer" : ""}
                  </li>;
                })}</ul>
                {entry.question.explanation ? (
                  <p className="mt-1 text-xs text-slate-600">💡 {entry.question.explanation}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        </div>
      ) : null}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4"><h2 className="text-sm font-bold">Practice answers</h2><p className="mt-1 text-xs text-slate-500">Recent individual practice questions answered in Telegram.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 uppercase"><tr><th className="px-3 py-3">Student</th><th className="px-3 py-3">Subject / chapter</th><th className="px-3 py-3">Question</th><th className="px-3 py-3">Answer</th><th className="px-3 py-3">Outcome</th><th className="px-3 py-3">Date</th></tr></thead><tbody>
          {practice.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="px-3 py-3">{entry.student.firstName ?? "Student"} {entry.student.lastName ?? ""}</td><td className="px-3 py-3">{entry.question.subject?.name ?? "—"}{entry.question.chapter ? ` · ${entry.question.chapter.title}` : ""}</td><td className="max-w-sm truncate px-3 py-3" title={entry.question.questionText}>{entry.question.questionText}</td><td className="px-3 py-3">{entry.chosenOption ? `${entry.chosenOption.label}) ${entry.chosenOption.text}` : "—"}</td><td className="px-3 py-3"><span className={entry.isCorrect ? "text-emerald-400" : "text-rose-400"}>{entry.isCorrect ? "Correct" : "Incorrect"}</span></td><td className="px-3 py-3">{new Date(entry.answeredAt).toLocaleString()}</td></tr>)}
          {!practice.length ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">No practice answers recorded.</td></tr> : null}
        </tbody></table></div>
      </section>
    </div>
  );
}
