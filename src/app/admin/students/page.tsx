"use client";

import { useEffect, useState } from "react";

type StudentRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  telegramUsername: string | null;
  telegramId: string;
  grade?: { name: string } | null;
  stream: string | null;
  isActive: boolean;
  activatedUntil: string | null;
  answered: number;
  accuracy: number | null;
  qualified_referrals: number;
  _count?: { referralsGiven?: number };
};

type Detail = {
  student: StudentRow;
  progress: {
    questions_answered: number;
    accuracy: number;
    tests_completed: number;
    mock_exams_completed: number;
    open_mistakes: number;
  };
};

export default function StudentsPage() {
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [grades, setGrades] = useState<Array<{ id: number; name: string; level?: number }>>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [editGrade, setEditGrade] = useState("");
  const [editStream, setEditStream] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(term = search, grade = gradeId) {
    const response = await fetch(
      `/api/students?per_page=100${term ? `&search=${encodeURIComponent(term)}` : ""}${grade ? `&grade_id=${grade}` : ""}`,
      { credentials: "same-origin" },
    );
    const body = (await response.json().catch(() => ({ data: [] }))) as { data?: StudentRow[] };
    setRows(body.data ?? []);
  }

  useEffect(() => {
    void fetch("/api/v1/grades?per_page=100", { credentials: "same-origin" }).then((response) => response.json()).then((body: { data?: Array<{ id: number; name: string; level?: number }> }) => setGrades(body.data ?? []));
  }, []);

  useEffect(() => {
    void load(search, gradeId);
    const timer = window.setInterval(() => void load(search, gradeId), 15_000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, gradeId]);

  async function patch(id: number, payload: Record<string, unknown>) {
    setMessage(null);
    const response = await fetch(`/api/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      setMessage("Saved.");
      await load();
      await open(id);
    } else {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setMessage(body.message ?? "Update failed.");
    }
  }

  async function open(id: number) {
    const response = await fetch(`/api/students/${id}`, { credentials: "same-origin" });
    if (response.ok) setDetail((await response.json()) as Detail);
  }

  async function openEdit(id: number) {
    const response = await fetch(`/api/students/${id}`, { credentials: "same-origin" });
    if (!response.ok) {
      setMessage("Could not load student details.");
      return;
    }
    const body = (await response.json()) as { student: StudentRow & { gradeId?: number | null } };
    setEditing(body.student);
    setEditGrade(body.student.gradeId == null ? "" : String(body.student.gradeId));
    setEditStream(body.student.stream ?? "");
    setEditActive(body.student.isActive);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    const response = await fetch(`/api/students/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ grade_id: editGrade ? Number(editGrade) : null, stream: editStream || null, is_active: editActive }),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string };
      setMessage(body.message ?? "Could not save student.");
      return;
    }
    setEditing(null);
    setMessage("Student updated.");
    await load();
    if (detail?.student.id === editing.id) await open(editing.id);
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or username…"
          className="min-w-52 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select aria-label="Filter students by grade" value={gradeId} onChange={(event) => setGradeId(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="">All grades</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select>
        <span className="text-xs text-slate-500">{rows.length} students · refreshes every 15 seconds</span>
      </form>

      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Grade / stream</th>
              <th className="px-4 py-2">Answered</th>
              <th className="px-4 py-2">Accuracy</th>
              <th className="px-4 py-2">Telegram</th>
              <th className="px-4 py-2">Invited</th>
              <th className="px-4 py-2">Activation</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{row.id}</td>
                <td className="px-4 py-2">
                  {row.firstName ?? "—"} {row.lastName ?? ""}{" "}
                  {row.telegramUsername ? `(@${row.telegramUsername})` : ""}
                </td>
                <td className="px-4 py-2">{row.grade?.name ?? "—"}{row.stream ? <small className="block capitalize text-slate-500">{row.stream}</small> : null}</td>
                <td className="px-4 py-2">{row.answered}</td>
                <td className="px-4 py-2">{row.accuracy != null ? `${row.accuracy}%` : "—"}</td>
                <td className="px-4 py-2">{row.telegramUsername ? `@${row.telegramUsername}` : row.telegramId}</td>
                <td className="px-4 py-2">{row._count?.referralsGiven ?? 0}<small className="block text-slate-500">{row.qualified_referrals} qualified</small></td>
                <td className="px-4 py-2">
                  {row.activatedUntil ? <span className="text-emerald-400">{new Date(row.activatedUntil).toLocaleDateString()}</span> : <span className="text-slate-400">Free account</span>}
                </td>
                <td className="px-4 py-2">
                  <button onClick={() => patch(row.id, { activate_for_days: 30 })} className="mr-1 rounded bg-teal-500 px-2 py-1 text-xs font-semibold text-white">Activate 30 days</button>
                  <button onClick={() => void openEdit(row.id)} className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs">Edit</button>
                  <button
                    onClick={() => open(row.id)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  No students.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {detail ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold">
              {detail.student.firstName ?? "Student"} #{detail.student.id}
            </h2>
            <button
              onClick={() => setDetail(null)}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <p className="text-sm text-slate-600">
            Answered {detail.progress.questions_answered} · accuracy {detail.progress.accuracy}% ·
            tests {detail.progress.tests_completed} · mocks {detail.progress.mock_exams_completed} ·
            open mistakes {detail.progress.open_mistakes}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => patch(detail.student.id, { activate_for_days: 30 })}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Activate 30 days
            </button>
            <button
              onClick={() => patch(detail.student.id, { revoke_activation: true })}
              className="rounded-md bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-500"
            >
              Revoke activation
            </button>
            <button
              onClick={() => patch(detail.student.id, { is_active: !detail.student.isActive })}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
            >
              {detail.student.isActive ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        </div>
      ) : null}

      {editing ? <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
        <form onSubmit={saveEdit} role="dialog" aria-modal="true" aria-labelledby="student-edit-title" className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
          <div className="flex items-start justify-between"><div><h2 id="student-edit-title" className="text-lg font-semibold">Edit student</h2><p className="text-sm text-slate-500">{editing.firstName ?? "Student"} {editing.lastName ?? ""} · Telegram ID {editing.telegramId}</p></div><button type="button" aria-label="Close" onClick={() => setEditing(null)} className="rounded border border-slate-300 px-2 py-1">✕</button></div>
          <label className="block text-sm">Grade<select value={editGrade} onChange={(event) => { setEditGrade(event.target.value); if (grades.find((grade) => String(grade.id) === event.target.value)?.level !== 12) setEditStream(""); }} className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"><option value="">No grade</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></label>
          {grades.find((grade) => String(grade.id) === editGrade)?.level === 12 ? <label className="block text-sm">Grade 12 stream<select value={editStream} onChange={(event) => setEditStream(event.target.value)} required className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"><option value="">Choose stream</option><option value="natural">Natural</option><option value="social">Social</option></select></label> : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} /> Active account</label>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setEditing(null)} className="rounded border border-slate-300 px-3 py-2 text-sm">Cancel</button><button disabled={saving} type="submit" className="rounded bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button></div>
        </form>
      </div> : null}
    </div>
  );
}
