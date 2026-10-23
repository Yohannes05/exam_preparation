"use client";

import { useEffect, useState } from "react";

type Grade = { id: number; name: string };
type Notice = { id: number; title: string; body: string; audience: string; gradeId: number | null; grade?: Grade | null; isPublished: boolean; publishedAt: string | null };

export function AdminAnnouncements() {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [gradeId, setGradeId] = useState("");
  const [send, setSend] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [gradeResponse, noticeResponse] = await Promise.all([
      fetch("/api/v1/grades?per_page=100", { credentials: "same-origin" }),
      fetch("/api/v1/announcements?per_page=100", { credentials: "same-origin" }),
    ]);
    const gradeData = await gradeResponse.json().catch(() => ({ data: [] })) as { data?: Grade[] };
    const noticeData = await noticeResponse.json().catch(() => ({ data: [] })) as { data?: Notice[] };
    setGrades(gradeData.data ?? []);
    setNotices(noticeData.data ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function publish(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const response = await fetch("/api/announcements/publish", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ title: title.trim(), body: body.trim(), audience, grade_id: audience === "grade" ? gradeId : null, send_as_message: send }),
    });
    const result = await response.json().catch(() => ({})) as { message?: string; messages_sent?: number; messages_failed?: number };
    if (!response.ok) setMessage(result.message ?? "Notice could not be published.");
    else {
      setMessage(`Notice published.${send ? ` Telegram messages sent: ${result.messages_sent ?? 0}. Failed: ${result.messages_failed ?? 0}.` : ""}`);
      setTitle(""); setBody(""); setAudience("all"); setGradeId(""); setSend(false); await load();
    }
    setBusy(false);
  }

  async function toggle(notice: Notice) {
    const response = await fetch(`/api/v1/announcements/${notice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ is_published: !notice.isPublished }) });
    if (response.ok) await load();
    else setMessage("Could not update this notice.");
  }
  async function remove(id: number) {
    if (!window.confirm("Delete this notice permanently?")) return;
    const response = await fetch(`/api/v1/announcements/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) await load(); else setMessage("Could not delete this notice.");
  }

  return <div className="space-y-4">
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
      <form onSubmit={publish} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="border-b border-slate-200 pb-3"><h3 className="text-sm font-bold">New notice</h3><p className="mt-1 text-xs text-slate-500">Write an update and choose who should see it.</p></div>
        <label className="block text-xs font-semibold">Title <span className="text-teal-400">REQUIRED</span><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. New exam questions added" className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
        <label className="block text-xs font-semibold">Message <span className="text-teal-400">REQUIRED</span><textarea required maxLength={10000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write the update students will see in the bot" className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
        <p className="text-[11px] text-slate-500">Students can open published notices from the bot’s Notices menu.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">Show to<select value={audience} onChange={(event) => setAudience(event.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm font-normal"><option value="all">All students</option><option value="grade">One grade</option><option value="activated">Activated students</option></select></label>
          <label className="block text-xs font-semibold">Grade{audience === "grade" ? " · REQUIRED" : ""}<select required={audience === "grade"} disabled={audience !== "grade"} value={gradeId} onChange={(event) => setGradeId(event.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm font-normal"><option value="">Choose grade</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></label></div>
        <label className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs"><input type="checkbox" checked={send} onChange={(event) => setSend(event.target.checked)} />Also send this notice as a Telegram message now</label>
        <p className="text-[11px] text-slate-500">Message delivery needs the Telegram bot token. Published notices also appear in the bot’s Notices menu.</p>
        {message ? <p role="status" className="text-xs text-teal-300">{message}</p> : null}
        <div className="flex justify-end border-t border-slate-200 pt-3"><button disabled={busy} className="rounded bg-teal-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? "Publishing…" : "Publish notice"}</button></div>
      </form>
      <div className="space-y-3">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-200 p-4"><h3 className="text-sm font-bold">Student preview</h3><p className="mt-1 text-xs text-slate-500">This is how the notice appears in Telegram.</p></div><div className="min-h-44 bg-[#dcebe7] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-700"><span className="grid h-6 w-6 place-items-center rounded-full bg-teal-600 text-white">E</span>Exam Prep Bot <small className="font-normal text-slate-500">bot</small></div><div className="max-w-sm rounded-xl bg-white p-3 text-slate-900 shadow-sm"><p className="text-[10px] font-bold text-teal-700">📢 Notice{audience === "grade" && gradeId ? ` · ${grades.find((item) => String(item.id) === gradeId)?.name ?? "Grade"}` : ""}</p><strong className="mt-1 block text-xs">{title || "Your notice title"}</strong><p className="mt-1 whitespace-pre-wrap text-xs">{body || "Your message will appear here as you type."}</p><small className="mt-2 block text-right text-[9px] text-slate-400">now</small></div></div></section>
        <section className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold">Who sees it?</h3><div className="mt-3 space-y-2 text-[11px] text-slate-500"><p><b className="text-slate-200">All students</b> can read it from Notices.</p><p><b className="text-slate-200">One grade</b> is visible only to students in that grade.</p><p><b className="text-slate-200">Activated students</b> restricts the notice to active subscriptions.</p></div></section>
      </div>
    </div>
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-200 p-4"><h3 className="text-sm font-bold">Notice history</h3><p className="mt-1 text-xs text-slate-500">Hide a notice to remove it from the bot menu.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 uppercase"><tr><th className="px-3 py-3">Title</th><th className="px-3 py-3">Audience</th><th className="px-3 py-3">Published</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{notices.map((notice) => <tr key={notice.id} className="border-t border-slate-100"><td className="px-3 py-3 font-semibold">{notice.title}<small className="block max-w-sm truncate pt-1 font-normal text-slate-500">{notice.body}</small></td><td className="px-3 py-3">{notice.audience === "grade" ? notice.grade?.name ?? "One grade" : notice.audience === "activated" ? "Activated" : "All students"}</td><td className="px-3 py-3">{notice.publishedAt ? new Date(notice.publishedAt).toLocaleDateString() : "—"}</td><td className="px-3 py-3">{notice.isPublished ? "Published" : "Draft"}</td><td className="px-3 py-3"><button onClick={() => void toggle(notice)} className="mr-2 rounded border border-slate-300 px-2 py-1">{notice.isPublished ? "Hide" : "Publish"}</button><button onClick={() => void remove(notice.id)} className="text-rose-400">Delete</button></td></tr>)}{!notices.length ? <tr><td colSpan={5} className="p-7 text-center text-slate-500">No notices yet. Publish the first one above.</td></tr> : null}</tbody></table></div></section>
  </div>;
}
