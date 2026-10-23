"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type InventoryItem = { total: number; available: number; description: string };
type DashboardPayload = {
  students: { total: number; active: number; activated: number; new_this_week: number };
  referrals: { total: number; qualified: number };
  activity: { questions_answered: number; accuracy: number; mock_exams_completed: number; chapter_tests_completed: number };
  inventory: Record<string, InventoryItem>;
  popular_subjects: Array<{ id: number; name: string; answers: number; accuracy: number }>;
  difficult_questions: Array<{ id: number; question_text: string; attempts: number; accuracy: number }>;
};

const inventoryLinks: Array<{ key: string; label: string; href: string; color: string }> = [
  { key: "grades", label: "Grades", href: "/admin/crud/grades", color: "bg-violet-50 text-violet-700" },
  { key: "subjects", label: "Subjects", href: "/admin/crud/subjects", color: "bg-blue-50 text-blue-700" },
  { key: "chapters", label: "Chapters", href: "/admin/crud/chapters", color: "bg-amber-50 text-amber-700" },
  { key: "topics", label: "Topics", href: "/admin/crud/topics", color: "bg-cyan-50 text-cyan-700" },
  { key: "notes", label: "Lesson notes", href: "/admin/crud/notes", color: "bg-emerald-50 text-emerald-700" },
  { key: "questions", label: "Questions", href: "/admin/crud/questions", color: "bg-rose-50 text-rose-700" },
  { key: "exams", label: "Exams", href: "/admin/crud/exams", color: "bg-indigo-50 text-indigo-700" },
  { key: "announcements", label: "Announcements", href: "/admin/crud/announcements", color: "bg-orange-50 text-orange-700" },
];

function number(value: number): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/dashboard", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Dashboard could not load (HTTP ${response.status}).`);
      setData((await response.json()) as DashboardPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard could not load.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <div role="alert" className="rounded-xl border border-rose-200 bg-white p-6 text-sm text-rose-700"><p>{error}</p><button onClick={() => void load()} className="mt-3 rounded-lg bg-rose-600 px-3 py-2 font-semibold text-white hover:bg-rose-700">Try again</button></div>;
  if (!data) return <div className="space-y-5" aria-label="Loading dashboard"><div className="h-40 animate-pulse rounded-2xl bg-slate-200"/><div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-slate-200"/>)}</div></div>;

  const examsCompleted = data.activity.mock_exams_completed + data.activity.chapter_tests_completed;
  const stats = [
    { label: "Registered students", value: number(data.students.total), hint: `${number(data.students.new_this_week)} new this week`, href: "/admin/students", color: "text-blue-700", icon: "♙" },
    { label: "Activated accounts", value: number(data.students.activated), hint: "Active subscriptions", href: "/admin/students", color: "text-emerald-700", icon: "✓" },
    { label: "Questions answered", value: number(data.activity.questions_answered), hint: `${data.activity.accuracy}% average accuracy`, href: "/admin/crud/questions", color: "text-violet-700", icon: "?" },
    { label: "Exams completed", value: number(examsCompleted), hint: `${data.activity.mock_exams_completed} mock · ${data.activity.chapter_tests_completed} chapter`, href: "/admin/results", color: "text-amber-700", icon: "▤" },
    { label: "Student referrals", value: number(data.referrals.total), hint: `${number(data.referrals.qualified)} qualified`, href: "/admin/students", color: "text-rose-700", icon: "↗" },
  ];

  const quickActions = [
    { label: "Add a grade", hint: "Set up a grade students can choose.", href: "/admin/crud/grades", icon: "+" },
    { label: "Add a subject", hint: "Organize learning under a grade.", href: "/admin/crud/subjects", icon: "▤" },
    { label: "Add a chapter", hint: "Create a lesson or quiz section.", href: "/admin/crud/chapters", icon: "▣" },
    { label: "Manage students", hint: "Review progress and access.", href: "/admin/students", icon: "♙" },
  ];

  return <div className="space-y-7">
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#123d39] via-[#176d63] to-[#228679] px-6 py-7 text-white shadow-sm sm:px-8 sm:py-8">
      <div className="absolute -right-10 -top-24 h-72 w-72 rounded-full border-[36px] border-white/[0.06]" aria-hidden="true"/>
      <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div><span className="text-[10px] font-extrabold tracking-[0.18em] text-emerald-100/75">ADMIN OVERVIEW</span><h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-[28px]">Welcome back</h2><p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50/85">Keep courses organized, publish learning material, and help students prepare for their exams.</p></div>
        <Link href="/admin/crud/questions" className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#145b54] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><span aria-hidden="true">＋</span> Add a question</Link>
      </div>
    </section>

    <section aria-label="Platform summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {stats.map((stat) => <Link key={stat.label} href={stat.href} className="group flex min-h-[128px] flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_8px_rgba(16,32,30,.035)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md sm:p-5">
        <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-500"><span>{stat.label}</span><span className={`grid h-8 w-8 place-items-center rounded-lg text-base ${stat.color} bg-slate-50`}>{stat.icon}</span></span>
        <span><strong className="block text-2xl font-extrabold tabular-nums tracking-tight text-slate-900 sm:text-[28px]">{stat.value}</strong><small className="mt-1 block text-[11px] text-slate-500">{stat.hint}</small></span>
      </Link>)}
    </section>

    <section className="space-y-3">
      <div><h2 className="text-base font-extrabold text-slate-900">Quick actions</h2><p className="mt-1 text-xs text-slate-500">Start common admin tasks.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map((action) => <Link key={action.label} href={action.href} className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_8px_rgba(16,32,30,.035)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-lg font-bold text-emerald-700">{action.icon}</span><span className="min-w-0"><strong className="block text-xs font-bold text-slate-800">{action.label}</strong><small className="mt-1 block text-[11px] leading-4 text-slate-500">{action.hint}</small></span><span className="ml-auto text-xl text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" aria-hidden="true">›</span>
        </Link>)}
      </div>
    </section>

    <section className="space-y-3">
      <div><h2 className="text-base font-extrabold text-slate-900">Learning content</h2><p className="mt-1 text-xs text-slate-500">Manage the material students see in Telegram.</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {inventoryLinks.map((item) => {
          const stats = data.inventory[item.key] ?? { total: 0, available: 0, description: "" };
          return <Link key={item.key} href={item.href} className="group rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_8px_rgba(16,32,30,.035)] transition hover:-translate-y-0.5 hover:shadow-md sm:p-5">
            <div className="flex items-start justify-between gap-2"><span className={`rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${item.color}`}>{item.label}</span><span className="text-slate-300 transition group-hover:text-emerald-600" aria-hidden="true">↗</span></div>
            <strong className="mt-4 block text-2xl font-extrabold tabular-nums text-slate-900">{number(stats.total)}</strong><p className="mt-1 text-[11px] font-semibold text-emerald-700">{number(stats.available)} available</p><p className="mt-2 text-[10px] leading-4 text-slate-500">{stats.description}</p>
          </Link>;
        })}
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(16,32,30,.035)]">
        <div className="mb-4"><h2 className="text-sm font-extrabold text-slate-900">Popular subjects</h2><p className="mt-1 text-[11px] text-slate-500">Ranked by student answers.</p></div>
        {data.popular_subjects.length ? <div className="space-y-3">{data.popular_subjects.map((subject) => <div key={subject.id} className="flex items-center gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{subject.name}</span><span className="text-[11px] tabular-nums text-slate-500">{number(subject.answers)} answers</span><span className="w-12 text-right text-xs font-bold text-emerald-700">{subject.accuracy}%</span></div>)}</div> : <p className="rounded-lg bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">No student answers yet.</p>}
      </div>
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(16,32,30,.035)]">
        <div className="mb-4"><h2 className="text-sm font-extrabold text-slate-900">Questions students find difficult</h2><p className="mt-1 text-[11px] text-slate-500">Questions with at least three attempts.</p></div>
        {data.difficult_questions.length ? <div className="space-y-3">{data.difficult_questions.map((question) => <div key={question.id} className="flex items-start gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="min-w-0 flex-1 text-xs leading-5 text-slate-700">{question.question_text}</span><span className="shrink-0 text-right"><strong className="block text-xs font-bold text-rose-700">{question.accuracy}%</strong><small className="text-[10px] text-slate-500">{number(question.attempts)} attempts</small></span></div>)}</div> : <p className="rounded-lg bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">Need at least three attempts per question to show this list.</p>}
      </div>
    </section>
  </div>;
}
