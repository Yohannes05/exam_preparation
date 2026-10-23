"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type NavLink = { href: string; label: string; section: string };

function NavIcon({ label }: { label: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  let glyph: ReactNode;
  switch (label) {
    case "Dashboard": glyph = <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>; break;
    case "Students": glyph = <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/></>; break;
    case "Results": glyph = <><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 13h6m-6 4h6"/></>; break;
    case "Grades": glyph = <><path d="M12 3v18m-7-7 7 7 7-7"/><path d="M5 4h14"/></>; break;
    case "Subjects": glyph = <><path d="M4 4h16v16H4zM8 8h8m-8 4h8m-8 4h5"/></>; break;
    case "Chapters": case "Notes": glyph = <><path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5"/></>; break;
    case "Topics": glyph = <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2m10 8h-2"/></>; break;
    case "Questions": glyph = <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.1 1-1.9 1.2-1.9 3.1m0 3h.01"/></>; break;
    case "Import questions": glyph = <><path d="M12 15V3m0 0L7 8m5-5 5 5M5 14v6h14v-6"/></>; break;
    case "Notices": glyph = <><path d="M4 13V8a2 2 0 0 1 2-2h2l9-3v17l-9-3H6a2 2 0 0 1-2-2v-1m4-8 2 9m11-8a3 3 0 0 1 0 6"/></>; break;
    case "Exams": glyph = <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 12 2.5 2.5L16 9m-8-3h8"/></>; break;
    case "Payments": glyph = <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/></>; break;
    default: glyph = <><path d="M4 12h16M12 4v16"/></>;
  }
  return <svg {...common}>{glyph}</svg>;
}

const descriptions: Record<string, string> = {
  "/admin/dashboard": "A clear view of your students, learning content, and activity.",
  "/admin/students": "Review student accounts, progress, and activation status.",
  "/admin/results": "Review completed tests and exam answers.",
  "/admin/payments": "Review payment receipts and account activations.",
  "/admin/import": "Preview and import questions from a spreadsheet.",
  "/admin/crud/grades": "Set up the grade levels available to students.",
  "/admin/crud/subjects": "Organize courses by grade. Add and number units from Chapters.",
  "/admin/crud/chapters": "Add learning units, publish notes, and manage chapter PDFs.",
  "/admin/crud/topics": "Group related questions and notes within a chapter.",
  "/admin/crud/notes": "Write lesson content and publish it to the Telegram bot.",
  "/admin/crud/questions": "Add, edit, and organize practice questions for the Telegram bot.",
  "/admin/crud/exams": "Create chapter tests and mock exams for the bot.",
  "/admin/crud/announcements": "Publish updates students can read in the bot and optionally receive as a message.",
};

export function AdminNav({ links, admin, children }: { links: NavLink[]; admin: { name: string; email: string }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const title = links.find((link) => link.href === pathname)?.label ?? "Admin";

  async function logout() {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    router.replace("/login");
    router.refresh();
  }

  let previousSection = "";

  return <div className="admin-theme min-h-screen bg-[#f3f6f5] text-slate-800 lg:pl-[264px]">
    {mobileOpen ? <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden" /> : null}

    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col bg-[#123d39] text-white shadow-xl transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <Link href="/admin/dashboard" onClick={() => setMobileOpen(false)} className="flex h-[78px] items-center gap-3 border-b border-white/10 px-5">
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white shadow-lg shadow-blue-950/20">
          <Image src="/logo.png" alt="National Exam Preparation logo" fill sizes="48px" className="object-contain" priority />
        </span>
        <span className="min-w-0"><span className="block truncate text-sm font-bold tracking-tight">National Exam Prep</span><span className="mt-0.5 block text-[11px] text-emerald-100/60">Admin dashboard</span></span>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {links.map((link) => {
          const sectionHeading = link.section !== previousSection;
          previousSection = link.section;
          const active = pathname === link.href || (link.href.startsWith("/admin/crud/") && pathname.startsWith(`${link.href}/`));
          return <div key={link.href}>
            {sectionHeading ? <p className="mb-1 mt-4 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-100/45 first:mt-0">{link.section}</p> : null}
            <Link href={link.href} onClick={() => setMobileOpen(false)} aria-current={active ? "page" : undefined} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${active ? "bg-white/12 text-white shadow-[inset_3px_0_0_#3b82f6]" : "text-emerald-50/75 hover:bg-white/[0.07] hover:text-white"}`}>
              <span className={active ? "text-blue-300" : "text-emerald-100/55 group-hover:text-emerald-100"}><NavIcon label={link.label}/></span>
              {link.label}
            </Link>
          </div>;
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-5 text-emerald-100/55">Ethiopian Exam Prep<br/><span className="text-emerald-100/35">Content and student management</span></div>
    </aside>

    <div className="min-h-screen min-w-0">
      <header className="sticky top-0 z-30 flex min-h-[78px] items-center gap-4 border-b border-slate-200/80 bg-white/95 px-4 shadow-sm backdrop-blur sm:px-7">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-900">{title}</h1>
          <p className="hidden truncate text-xs text-slate-500 sm:block">{descriptions[pathname] ?? "Manage your exam preparation platform."}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 sm:flex">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{admin.name.trim().charAt(0).toUpperCase()}</span>
            <span className="max-w-40"><span className="block truncate text-xs font-semibold text-slate-800">{admin.name}</span><span className="block truncate text-[10px] text-slate-500">{admin.email}</span></span>
          </div>
          <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">Log out</button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  </div>;
}
