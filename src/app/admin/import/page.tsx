"use client";

import { useEffect, useState } from "react";

type Grade = { id: number; name: string; level: number };
type Subject = { id: number; name: string };
type PreviewRow = {
  row: number;
  question_text: string;
  correct_answer: string | null;
  chapter_number: string;
  duplicate: boolean;
  errors: string[];
  ready: boolean;
};
type Preview = {
  preview_key: string;
  rows: PreviewRow[];
  total: number;
  ready: number;
  duplicates: number;
  needs_fix: number;
};

export default function ImportPage() {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [source, setSource] = useState("");
  const [year, setYear] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/grades?per_page=100", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load grades (HTTP ${response.status}).`);
        const body = (await response.json()) as { data: Grade[] };
        setGrades(body.data);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load grades."));
  }, []);

  useEffect(() => {
    setSubjects([]);
    setSubjectId("");
    setPreview(null);
    if (!gradeId) return;
    fetch(`/api/v1/subjects?per_page=100&grade_id=${encodeURIComponent(gradeId)}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load subjects (HTTP ${response.status}).`);
        const body = (await response.json()) as { data: Subject[] };
        setSubjects(body.data);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load subjects."));
  }, [gradeId]);

  async function makePreview(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("grade_id", gradeId);
      form.append("subject_id", subjectId);
      if (source.trim()) form.append("source", source.trim());
      if (year.trim()) form.append("year", year.trim());
      const response = await fetch("/api/questions/import/preview", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? `Preview failed (HTTP ${response.status}).`);
      setPreview(body as Preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/questions/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ preview_key: preview.preview_key }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? `Import failed (HTTP ${response.status}).`);
      setResult(`${body.imported} questions imported; ${body.skipped} skipped.`);
      setPreview(null);
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-4">
    <p className="max-w-3xl text-sm text-slate-600">
      Upload a CSV or XLSX with columns for Question, at least two choices (A–D), Answer, and Chapter number. Review the preview, then import valid rows. Chapter numbers must match the selected subject.
    </p>

    <form onSubmit={makePreview} className="max-w-2xl space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <label className="block text-sm">Grade
        <select required value={gradeId} onChange={(event) => setGradeId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2">
          <option value="">Choose a grade…</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name} (Grade {grade.level})</option>)}
        </select>
      </label>
      <label className="block text-sm">Subject
        <select required disabled={!gradeId} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2 disabled:bg-slate-100">
          <option value="">Choose a subject…</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Default source (optional)<input value={source} onChange={(event) => setSource(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2" /></label>
        <label className="block text-sm">Default year, E.C. (optional)<input type="number" min="1900" max="2100" value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2" /></label>
      </div>
      <label className="block text-sm">Question file
        <input required type="file" accept=".xlsx,.csv,.txt" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} className="mt-1 block text-sm" />
      </label>
      <button type="submit" disabled={!file || !gradeId || !subjectId || busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? "Working…" : "Preview import"}
      </button>
    </form>

    {error ? <p role="alert" className="max-w-2xl rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {result ? <p role="status" className="max-w-2xl rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{result}</p> : null}

    {preview ? <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm"><span className="font-medium">{preview.ready} ready</span> · {preview.duplicates} duplicates · {preview.needs_fix} need fixes · {preview.total} total</div>
        <button onClick={commitImport} disabled={preview.ready === 0 || busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "Importing…" : `Import ${preview.ready} ready questions`}</button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Question</th><th className="px-3 py-2">Chapter</th><th className="px-3 py-2">Answer</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.row} className="border-t border-slate-100"><td className="px-3 py-2">{row.row}</td><td className="max-w-lg px-3 py-2">{row.question_text}</td><td className="px-3 py-2">{row.chapter_number || "—"}</td><td className="px-3 py-2">{row.correct_answer ?? "—"}</td><td className="min-w-52 px-3 py-2">{row.ready ? <span className="text-emerald-700">Ready</span> : <span className="text-rose-700">{row.duplicate ? "Duplicate. " : ""}{row.errors.join(" ")}</span>}</td></tr>)}</tbody>
        </table>
      </div>
    </section> : null}
  </div>;
}
