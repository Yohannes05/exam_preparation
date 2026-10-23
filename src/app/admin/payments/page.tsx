"use client";

import { useCallback, useEffect, useState } from "react";

type PaymentRow = {
  id: number;
  student: { telegramId: string; firstName: string | null; lastName: string | null; grade?: { name: string } | null };
  method: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  reference: string | null;
  reviewReason: string | null;
  createdAt: string;
};

export default function PaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<PaymentRow | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/payments?per_page=100${status ? `&status=${status}` : ""}`, { credentials: "same-origin" });
    if (!response.ok) { setError(`Could not load payments (HTTP ${response.status}).`); return; }
    const body = await response.json() as { data?: PaymentRow[] };
    const next = body.data ?? [];
    setRows(next);
    setSelected((current) => current ? next.find((row) => row.id === current.id) ?? null : null);
    setError("");
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function review(row: PaymentRow, action: "approve" | "reject") {
    let reason: string | undefined;
    if (action === "reject") {
      const answer = window.prompt("Reason for rejecting this receipt:");
      if (answer === null) return;
      reason = answer.trim();
      if (!reason) { window.alert("A rejection reason is required."); return; }
    }
    const response = await fetch(`/api/payments/${row.id}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      ...(reason ? { body: JSON.stringify({ reason }) } : {}),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string };
      setError(body.message ?? `Could not ${action} this payment.`);
      return;
    }
    await load();
  }

  const pill = (value: string) => value === "approved" ? "bg-green-100 text-green-800" : value === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  return <div className="space-y-4">
    <div className="rounded-lg border border-teal-900/50 bg-teal-950/50 p-3 text-xs text-teal-100">Receipts are sent directly to the bot. Select a receipt to review its details and image.</div>
    {error ? <p role="alert" className="rounded border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p> : null}
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm"><label htmlFor="payment-status">Status</label><select id="payment-status" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded border border-slate-300 px-3 py-2"><option value="">All receipts</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><span className="text-xs text-slate-500">{rows.length} receipts</span></div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3"><h3 className="text-sm font-bold">Payment receipts</h3><p className="mt-1 text-[11px] text-slate-500">Select a receipt to review its details.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 uppercase"><tr><th className="px-3 py-3">Student</th><th className="px-3 py-3">Grade</th><th className="px-3 py-3">Method</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Submitted</th><th className="px-3 py-3">Status</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id} onClick={() => setSelected(row)} className={`cursor-pointer border-t border-slate-100 transition hover:bg-teal-950/30 ${selected?.id === row.id ? "bg-teal-950/40" : ""}`}><td className="px-3 py-3 font-medium">{row.student.firstName ?? row.student.telegramId} {row.student.lastName ?? ""}<small className="mt-1 block text-slate-500">@{row.student.telegramId}</small></td><td className="px-3 py-3">{row.student.grade?.name ?? "—"}</td><td className="px-3 py-3">{row.method}</td><td className="px-3 py-3">{row.amount} ETB</td><td className="px-3 py-3">{new Date(row.createdAt).toLocaleDateString()}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${pill(row.status)}`}>{row.status}</span></td></tr>)}
          {!rows.length ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">No receipts match this filter.</td></tr> : null}
        </tbody></table></div>
      </section>
      <section className="min-h-64 rounded-lg border border-slate-200 bg-white p-4">
        {selected ? <><div className="flex items-start justify-between"><div><h3 className="text-sm font-bold">Receipt #{selected.id}</h3><p className="mt-1 text-xs text-slate-500">{selected.student.firstName ?? "Student"} {selected.student.lastName ?? ""} · {selected.amount} ETB · {selected.method}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${pill(selected.status)}`}>{selected.status}</span></div>
          <img src={`/api/payments/${selected.id}/receipt`} alt={`Payment receipt ${selected.id}`} className="mt-4 max-h-[440px] w-full rounded-md border border-slate-200 bg-black/20 object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          {selected.reference ? <p className="mt-3 text-xs text-slate-500">Reference: {selected.reference}</p> : null}
          {selected.reviewReason ? <p className="mt-2 text-xs text-rose-300">Review note: {selected.reviewReason}</p> : null}
          {selected.status === "pending" ? <div className="mt-4 flex gap-2"><button onClick={() => void review(selected, "approve")} className="rounded bg-teal-500 px-3 py-2 text-xs font-bold text-white">Approve · activate 30 days</button><button onClick={() => void review(selected, "reject")} className="rounded border border-rose-800 px-3 py-2 text-xs font-semibold text-rose-300">Reject</button></div> : null}
        </> : <div className="grid min-h-56 place-content-center text-center"><span className="text-2xl text-teal-400">▧</span><h3 className="mt-2 text-sm font-bold">Select a receipt</h3><p className="mt-1 text-xs text-slate-500">The receipt image and student details will appear here.</p></div>}
      </section>
    </div>
  </div>;
}
