"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AdminAnnouncements } from "@/components/admin-announcements";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "textarea" | "boolean" | "select";
  required?: boolean;
  initial?: string;
  choices?: Array<{ value: string; label: string }>;
  source?: "grades" | "subjects" | "chapters" | "topics";
};
type OptionValue = { label: string; text: string; is_correct: boolean };
type Row = Record<string, unknown> & { id: number };

const FIELDS: Record<string, Field[]> = {
  grades: [
    { key: "name", label: "Name", required: true },
    { key: "level", label: "Grade level", type: "number", required: true, initial: "9" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "is_active", label: "Active", type: "boolean", initial: "true" },
  ],
  subjects: [
    { key: "grade_id", label: "Grade", type: "select", source: "grades", required: true },
    { key: "name", label: "Name", required: true },
    { key: "stream", label: "Student stream", type: "select", initial: "common", choices: [{ value: "common", label: "Shared / all streams" }, { value: "natural", label: "Natural" }, { value: "social", label: "Social" }] },
    { key: "language", label: "Language", type: "select", initial: "en", choices: [{ value: "en", label: "English" }, { value: "am", label: "Amharic" }] },
    { key: "description", label: "Description", type: "textarea" },
    { key: "order", label: "Order", type: "number", initial: "0" },
    { key: "is_active", label: "Active", type: "boolean", initial: "true" },
  ],
  chapters: [
    { key: "subject_id", label: "Subject", type: "select", source: "subjects", required: true },
    { key: "title", label: "Title", required: true },
    { key: "stream", label: "Student stream", type: "select", initial: "common", choices: [{ value: "common", label: "Shared / all streams" }, { value: "natural", label: "Natural" }, { value: "social", label: "Social" }] },
    { key: "description", label: "Description", type: "textarea" },
    { key: "order", label: "Order", type: "number", initial: "0" },
    { key: "is_active", label: "Active", type: "boolean", initial: "true" },
    { key: "requires_activation", label: "Requires activation", type: "boolean", initial: "false" },
    { key: "telegraph_url", label: "Telegraph URL" },
    { key: "pdf_file", label: "PDF file path" },
  ],
  topics: [
    { key: "chapter_id", label: "Chapter / unit", type: "select", source: "chapters", required: true },
    { key: "title", label: "Title", required: true },
    { key: "description", label: "Description", type: "textarea" },
    { key: "order", label: "Order", type: "number", initial: "0" },
  ],
  notes: [
    { key: "grade_id", label: "Grade", type: "select", source: "grades", required: true },
    { key: "subject_id", label: "Subject", type: "select", source: "subjects", required: true },
    { key: "chapter_id", label: "Chapter / unit", type: "select", source: "chapters", required: true },
    { key: "topic_id", label: "Topic (optional)", type: "select", source: "topics" },
    { key: "title", label: "Title", required: true },
    { key: "content", label: "Content", type: "textarea", required: true },
    { key: "order", label: "Order", type: "number", initial: "0" },
  ],
  questions: [
    { key: "grade_id", label: "Grade", type: "select", source: "grades", required: true },
    { key: "subject_id", label: "Subject", type: "select", source: "subjects", required: true },
    { key: "chapter_id", label: "Chapter (optional)", type: "select", source: "chapters" },
    { key: "topic_id", label: "Topic (optional)", type: "select", source: "topics" },
    { key: "question_text", label: "Question", type: "textarea", required: true },
    { key: "question_type", label: "Question type", type: "select", required: true, initial: "multiple_choice", choices: [{ value: "multiple_choice", label: "Multiple choice" }, { value: "true_false", label: "True / false" }] },
    { key: "difficulty", label: "Difficulty", type: "select", required: true, initial: "medium", choices: ["easy", "medium", "hard"].map((value) => ({ value, label: value })) },
    { key: "explanation", label: "Explanation", type: "textarea" },
    { key: "source", label: "Source" },
    { key: "year", label: "Year", type: "number" },
    { key: "is_active", label: "Active", type: "boolean", initial: "true" },
  ],
  exams: [
    { key: "title", label: "Title", required: true },
    { key: "type", label: "Exam type", type: "select", required: true, initial: "chapter_test", choices: [{ value: "chapter_test", label: "Chapter test" }, { value: "mock", label: "Mock exam" }] },
    { key: "grade_id", label: "Grade", type: "select", source: "grades", required: true },
    { key: "subject_id", label: "Subject", type: "select", source: "subjects", required: true },
    { key: "chapter_id", label: "Chapter (optional)", type: "select", source: "chapters" },
    { key: "question_count", label: "Question count", type: "number", required: true, initial: "10" },
    { key: "time_limit_minutes", label: "Time limit (minutes)", type: "number", required: true, initial: "20" },
    { key: "pass_mark", label: "Pass mark (%)", type: "number", required: true, initial: "50" },
    { key: "is_active", label: "Active", type: "boolean", initial: "true" },
  ],
  announcements: [
    { key: "title", label: "Title", required: true },
    { key: "body", label: "Message", type: "textarea", required: true },
    { key: "audience", label: "Audience", type: "select", required: true, initial: "all", choices: [{ value: "all", label: "All students" }, { value: "grade", label: "One grade" }, { value: "activated", label: "Activated students" }] },
    { key: "grade_id", label: "Grade ID (for grade audience)", type: "number" },
    { key: "is_published", label: "Published", type: "boolean", initial: "false" },
  ],
};

function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function valueFor(row: Row, key: string): unknown {
  return row[key] ?? row[camel(key)];
}

function initialOptions(row?: Row | null): OptionValue[] {
  const options = row?.options;
  if (Array.isArray(options) && options.length) {
    return options.map((option) => {
      const item = option as Record<string, unknown>;
      return { label: String(item.label ?? ""), text: String(item.text ?? ""), is_correct: Boolean(item.is_correct ?? item.isCorrect) };
    });
  }
  return ["A", "B", "C", "D"].map((label, index) => ({ label, text: "", is_correct: index === 0 }));
}

export default function CrudPage() {
  const params = useParams<{ resource: string }>();
  const searchParams = useSearchParams();
  const resource = params.resource;
  const fields = FIELDS[resource] ?? [];
  const hasOptions = resource === "questions";
  const [rows, setRows] = useState<Row[]>([]);
  const [references, setReferences] = useState<Record<string, Row[]>>({});
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries(["grade_id", "subject_id", "chapter_id", "topic_id"].flatMap((key) => searchParams.get(key) ? [[key, searchParams.get(key)!]] : [])));
  const [editing, setEditing] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [questionOptions, setQuestionOptions] = useState<OptionValue[]>(initialOptions());
  const [showForm, setShowForm] = useState(resource === "questions");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const sources = [...new Set(fields.flatMap((field) => field.source ? [field.source] : []))];
    if (!sources.length) return;
    Promise.all(sources.map(async (source) => {
      const response = await fetch(`/api/v1/${source}?per_page=100`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return [source, []] as const;
      const body = (await response.json().catch(() => ({ data: [] }))) as { data?: Row[] };
      return [source, body.data ?? []] as const;
    })).then((entries) => setReferences(Object.fromEntries(entries)));
  }, [fields]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ per_page: "50" });
    if (search.trim()) params.set("search", search.trim());
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const response = await fetch(`/api/v1/${resource}?${params}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      setLoadError(`Could not load ${resource} (HTTP ${response.status}).`);
      return;
    }
    const body = (await response.json().catch(() => ({ data: [] }))) as { data?: Row[] };
    setRows(body.data ?? []);
    setLoadError(null);
  }, [resource, search, filters]);

  useEffect(() => { if (fields.length > 0 && resource !== "announcements") void load(); }, [fields.length, load, resource]);

  function openForm(row: Row | null) {
    setEditing(row);
    const chapterId = filters.chapter_id;
    const chapter = chapterId ? (references.chapters ?? []).find((item) => item.id === Number(chapterId)) : undefined;
    const subject = chapter?.subject as Row | undefined;
    setValues(Object.fromEntries(fields.map((field) => {
      const inherited = resource === "notes" && chapter ? ({ grade_id: subject?.gradeId, subject_id: subject?.id, chapter_id: chapter.id } as Record<string, unknown>)[field.key] : undefined;
      const value = row ? valueFor(row, field.key) : filters[field.key] ?? inherited ?? field.initial;
      if (field.key === "stream" && value == null) return [field.key, "common"];
      return [field.key, value == null ? "" : String(value)];
    })));
    setQuestionOptions(initialOptions(row));
    setShowForm(true);
  }

  function choicesFor(field: Field): Row[] {
    const options = field.source ? references[field.source] ?? [] : [];
    if (field.source === "subjects") return options.filter((item) => !values.grade_id || String(valueFor(item, "grade_id")) === values.grade_id);
    if (field.source === "chapters") return options.filter((item) => {
      const subject = item.subject as Row | undefined;
      const subjectId = valueFor(item, "subject_id") ?? subject?.id;
      if (values.subject_id && String(subjectId) !== values.subject_id) return false;
      if (values.grade_id && subject?.gradeId != null && String(subject.gradeId) !== values.grade_id) return false;
      return true;
    });
    if (field.source === "topics") return options.filter((item) => !values.chapter_id || String(valueFor(item, "chapter_id")) === values.chapter_id);
    return options;
  }

  function filterChoicesFor(field: Field): Row[] {
    const options = field.source ? references[field.source] ?? [] : [];
    if (field.source === "subjects" && filters.grade_id) return options.filter((item) => String(valueFor(item, "grade_id")) === filters.grade_id);
    if (field.source === "chapters") return options.filter((item) => {
      const subject = item.subject as Row | undefined;
      const subjectId = valueFor(item, "subject_id") ?? subject?.id;
      if (filters.subject_id && String(subjectId) !== filters.subject_id) return false;
      if (filters.grade_id && subject?.gradeId != null && String(subject.gradeId) !== filters.grade_id) return false;
      return true;
    });
    if (field.source === "topics" && filters.chapter_id) return options.filter((item) => String(valueFor(item, "chapter_id")) === filters.chapter_id);
    return options;
  }

  function fieldText(field: Field, row: Row): string {
    const raw = valueFor(row, field.key);
    if (raw == null || raw === "") return "—";
    if (field.source) {
      const relation = (row[field.source.slice(0, -1)] ?? null) as Row | null;
      const found = (references[field.source] ?? []).find((item) => item.id === Number(raw));
      const item = relation ?? found;
      if (item) return String(item.name ?? item.title ?? item.level ?? raw);
    }
    if (field.type === "boolean") return raw ? "Active" : "Inactive";
    return String(raw);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const saveAndAdd = (event.nativeEvent as SubmitEvent).submitter instanceof HTMLElement && (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "save-next";
    if (hasOptions) {
      const filled = questionOptions.filter((option) => option.text.trim());
      if (filled.length < 2 || filled.filter((option) => option.is_correct).length !== 1) {
        window.alert("Add at least two answer choices and mark exactly one as correct.");
        return;
      }
    }
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.key] ?? "";
      payload[field.key] = field.key === "stream" && raw === "common" ? null : field.type === "boolean" ? raw === "true" : field.type === "number" ? (raw === "" ? null : Number(raw)) : (raw === "" ? null : raw);
    }
    if (hasOptions) payload.options = questionOptions.filter((option) => option.text.trim());

    const response = await fetch(editing ? `/api/v1/${resource}/${editing.id}` : `/api/v1/${resource}`, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      if (hasOptions) openForm(null);
      else if (saveAndAdd) openForm(null);
      else setShowForm(false);
      await load();
    } else {
      const body = (await response.json().catch(() => ({}))) as { message?: string; errors?: Record<string, string[]> };
      window.alert([body.message ?? "Save failed", ...Object.values(body.errors ?? {}).flat()].filter(Boolean).join(" "));
    }
  }

  async function destroy(id: number) {
    if (!window.confirm("Delete this record?")) return;
    const response = await fetch(`/api/v1/${resource}/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) await load();
    else window.alert(`Delete failed (HTTP ${response.status}).`);
  }

  async function publishChapter(id: number) {
    const response = await fetch(`/api/chapters/${id}/publish-notes`, { method: "POST", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as { url?: string; message?: string };
    if (!response.ok) window.alert(body.message ?? "Could not publish chapter notes.");
    else { window.alert("Chapter notes published to Telegram."); await load(); }
  }

  async function uploadChapterPdf(id: number, file: File | undefined) {
    if (!file) return;
    const form = new FormData(); form.append("pdf", file);
    const response = await fetch(`/api/chapters/${id}/pdf`, { method: "POST", body: form, credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) window.alert(body.message ?? "Could not upload the PDF.");
    else await load();
  }

  async function removeChapterPdf(id: number) {
    if (!window.confirm("Remove this chapter PDF?")) return;
    const response = await fetch(`/api/chapters/${id}/pdf`, { method: "DELETE", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) window.alert(body.message ?? "Could not remove the PDF.");
    else await load();
  }

  if (fields.length === 0) return <p className="text-slate-500">Unknown resource: {resource}</p>;
  if (resource === "announcements") return <AdminAnnouncements />;

  const filterFields = fields.filter((field) => field.source && ["grade_id", "subject_id", "chapter_id", "topic_id"].includes(field.key));
  const tableFields = hasOptions
    ? fields.filter((field) => ["question_text", "source", "year", "chapter_id"].includes(field.key))
    : resource === "subjects"
      ? fields.filter((field) => ["name", "grade_id", "stream", "language", "order", "is_active"].includes(field.key))
      : resource === "chapters"
        ? fields.filter((field) => ["title", "subject_id", "stream", "order", "is_active", "requires_activation"].includes(field.key))
        : fields;
  if (resource === "questions") filterFields.push(
    { key: "difficulty", label: "Difficulty", type: "select", choices: ["easy", "medium", "hard"].map((value) => ({ value, label: value })) },
    { key: "question_type", label: "Type", type: "select", choices: [{ value: "multiple_choice", label: "Multiple choice" }, { value: "true_false", label: "True / false" }] },
  );
  if (resource === "exams") filterFields.push({ key: "type", label: "Type", type: "select", choices: [{ value: "chapter_test", label: "Chapter test" }, { value: "mock", label: "Mock exam" }] });

  return <div className={hasOptions && showForm ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.9fr)]" : "space-y-4"}>
    <div className={hasOptions && showForm ? "min-w-0 space-y-4" : "contents"}>
    {loadError ? <p role="alert" className="text-sm text-rose-600">{loadError}</p> : null}
    <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <input aria-label={`Search ${resource}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${resource}…`} className="min-w-52 flex-1 rounded border border-slate-300 px-3 py-2 text-sm" />
      {filterFields.map((field) => <select key={field.key} aria-label={`Filter by ${field.label}`} value={filters[field.key] ?? ""} onChange={(event) => setFilters((old) => ({ ...old, [field.key]: event.target.value, ...(field.key === "grade_id" ? { subject_id: "", chapter_id: "", topic_id: "" } : {}), ...(field.key === "subject_id" ? { chapter_id: "", topic_id: "" } : {}), ...(field.key === "chapter_id" ? { topic_id: "" } : {}) }))} className="min-w-36 rounded border border-slate-300 px-3 py-2 text-sm">
        <option value="">{field.source ? `All ${field.label.toLowerCase()}s` : `All ${field.label.toLowerCase()}`}</option>
        {field.source ? filterChoicesFor(field).map((item) => <option key={item.id} value={item.id}>{String(item.name ?? item.title ?? `Grade ${item.level ?? item.id}`)}</option>) : field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>)}
      <span className="self-center text-xs text-slate-500">{rows.length} records</span>
      <button onClick={() => openForm(null)} className="rounded bg-teal-500 px-3 py-2 text-sm font-semibold text-white">＋ Add {resource}</button>
    </div>
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
        <th className="px-4 py-2">ID</th>{tableFields.map((field) => <th key={field.key} className="px-4 py-2">{field.key === "source" ? "Source / year" : field.key === "grade_id" ? "Grade" : field.key === "subject_id" ? "Subject" : field.key === "order" ? (resource === "chapters" ? "Chapter / unit #" : field.label) : field.key === "stream" ? "Stream" : field.label}</th>)}{resource === "subjects" ? <th className="px-4 py-2">Chapters / units</th> : null}{resource === "chapters" ? <><th className="px-4 py-2">Lesson notes</th><th className="px-4 py-2">Notes article</th><th className="px-4 py-2">PDF</th></> : null}{hasOptions ? <th className="px-4 py-2">Answer</th> : null}<th className="px-4 py-2">Actions</th>
      </tr></thead><tbody>
        {rows.map((row) => <tr key={row.id} className="border-t border-slate-100">
          <td className="px-4 py-2">{row.id}</td>{tableFields.map((field) => <td key={field.key} className="max-w-xs truncate px-4 py-2">{field.key === "source" ? [valueFor(row, "source"), valueFor(row, "year")].filter(Boolean).join(" · ") || "—" : field.key === "stream" ? String(valueFor(row, "stream") ?? "Shared") : field.key === "order" && resource === "chapters" ? (Number(row.order) > 0 ? `Chapter ${row.order}` : "Set chapter number") : field.key === "requires_activation" ? (row.requiresActivation ? <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">Activation required</span> : <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">Free</span>) : field.key === "is_active" ? (row.isActive ? <span className="text-emerald-500">Active</span> : <span className="text-slate-400">Hidden</span>) : fieldText(field, row)}</td>)}
          {resource === "subjects" ? <td className="max-w-sm px-4 py-2">{Array.isArray(row.chapters) && row.chapters.length ? (row.chapters as Row[]).map((chapter) => <span key={chapter.id} className="mr-1 inline-block rounded-full border border-slate-300 px-2 py-0.5 text-xs">Chapter {Number(chapter.order) || "—"} · {String(chapter.title)}</span>) : <span className="text-slate-400">No units yet</span>}</td> : null}
          {resource === "chapters" ? <><td className="px-4 py-2"><span className={`rounded px-2 py-1 text-xs ${Number((row._count as { notes?: number } | undefined)?.notes ?? 0) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{Number((row._count as { notes?: number } | undefined)?.notes ?? 0)} notes</span></td><td className="px-4 py-2">{row.telegraphUrl || row.telegraph_url ? <a className="text-teal-600 underline" href={String(row.telegraphUrl ?? row.telegraph_url)} target="_blank" rel="noreferrer">Open article</a> : <span className="text-slate-400">Not published</span>}</td><td className="px-4 py-2">{row.pdfFile || row.pdf_file ? <><span className="text-emerald-600">PDF ready</span> <button onClick={() => void removeChapterPdf(row.id)} className="text-xs text-rose-600 underline">Remove</button></> : <span className="text-slate-400">No PDF</span>}</td></> : null}{hasOptions ? <td className="px-4 py-2">{Array.isArray(row.options) ? (row.options as Array<{ label: string; isCorrect?: boolean; is_correct?: boolean }>).find((option) => option.is_correct ?? option.isCorrect)?.label ?? "—" : "—"}</td> : null}
          <td className="whitespace-nowrap px-4 py-2">{resource === "subjects" ? <a href={`/admin/crud/chapters?subject_id=${row.id}`} className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs">＋ Add unit</a> : null}{resource === "chapters" ? <><a href={`/admin/crud/notes?chapter_id=${row.id}`} className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs">Manage notes</a><a href={`/admin/crud/notes?chapter_id=${row.id}`} className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs">＋ Add note</a>{Number((row._count as { notes?: number } | undefined)?.notes ?? 0) > 0 ? <button onClick={() => void publishChapter(row.id)} className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs">Publish article</button> : <button disabled title="Add notes first" className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs opacity-50">Add notes first</button>}<label className="mr-1 cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs">Upload PDF<input type="file" accept="application/pdf" className="hidden" onChange={(event) => void uploadChapterPdf(row.id, event.target.files?.[0])} /></label></> : null}<button onClick={() => openForm(row)} className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">Edit</button><button onClick={() => destroy(row.id)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button></td>
        </tr>)}
        {rows.length === 0 ? <tr><td colSpan={tableFields.length + (hasOptions ? 3 : 2)} className="px-4 py-6 text-center text-slate-400">{hasOptions ? "No questions yet — create the first one." : "Empty."}</td></tr> : null}
      </tbody></table>
    </div>
    </div>

    {showForm ? <div className={hasOptions ? "min-w-0" : "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"}>
      <form onSubmit={save} className={`${hasOptions ? "sticky top-24 max-h-[calc(100vh-7rem)]" : "my-auto max-h-[90vh] w-full max-w-xl"} space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl`}>
        <div className="border-b border-slate-200 pb-3"><h2 className="text-sm font-bold uppercase tracking-wide">{hasOptions ? "Question editor" : `${editing ? "Edit" : "New"} ${resource.slice(0, -1)}`}</h2><p className="mt-1 text-xs text-slate-500">{hasOptions ? (editing ? "Update the question and answer choices." : "Choose a grade and subject, then add a question.") : "Enter the record details below."}</p></div>
        {fields.map((field) => <label key={field.key} className="block text-sm">
          <span className="text-xs font-medium text-slate-600">{field.label}</span>
          {field.type === "boolean" ? <input type="checkbox" checked={(values[field.key] ?? field.initial) === "true"} onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: String(event.target.checked) }))} className="ml-2 mt-1 align-middle" /> : field.type === "select" ? <select required={field.required} value={values[field.key] ?? field.initial ?? ""} onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value, ...(field.key === "grade_id" ? { subject_id: "", chapter_id: "", topic_id: "" } : {}), ...(field.key === "subject_id" ? { chapter_id: "", topic_id: "" } : {}), ...(field.key === "chapter_id" ? { topic_id: "" } : {}) }))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"><option value="">{field.key === "chapter_id" && resource === "questions" ? "No chapter (optional)" : "Choose…"}</option>{field.source ? choicesFor(field).map((item) => <option key={item.id} value={item.id}>{String(item.name ?? item.title ?? `Grade ${item.level ?? item.id}`)}</option>) : field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : field.type === "textarea" ? <textarea required={field.required} value={values[field.key] ?? ""} onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))} rows={field.key === "content" || field.key === "body" || field.key === "question_text" ? 5 : 2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" /> : <input type={field.type === "number" ? "number" : "text"} required={field.required} value={values[field.key] ?? ""} onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />}
        </label>)}
        {hasOptions ? <fieldset className="space-y-2 rounded border border-slate-200 p-3"><legend className="px-1 text-sm font-medium">Answer choices (mark one correct)</legend>
          {questionOptions.map((option, index) => <div key={option.label} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2"><span className="text-sm font-medium">{option.label}</span><input aria-label={`Option ${option.label}`} required={index < 2} value={option.text} onChange={(event) => setQuestionOptions((old) => old.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} className="min-w-0 rounded border border-slate-300 px-2 py-1.5 text-sm" /><label className="whitespace-nowrap text-xs"><input type="radio" name="correct-option" checked={option.is_correct} onChange={() => setQuestionOptions((old) => old.map((item, i) => ({ ...item, is_correct: i === index })))} /> Correct</label></div>)}
          {questionOptions.length < 4 ? <button type="button" onClick={() => setQuestionOptions((old) => [...old, { label: String.fromCharCode(65 + old.length), text: "", is_correct: false }])} className="rounded border border-slate-300 px-2 py-1 text-xs">Add choice</button> : null}
        </fieldset> : null}
        <div className="flex flex-wrap gap-2 pt-1">{!editing && !hasOptions ? <button type="submit" value="save-next" className="rounded border border-teal-600 px-3 py-1.5 text-sm font-medium text-teal-700">Save + add another</button> : null}<button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Save</button><button type="button" onClick={() => setShowForm(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Cancel</button></div>
      </form>
    </div> : null}
  </div>;
}
