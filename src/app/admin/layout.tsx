import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/admin-nav";

const links = [
  { section: "Overview", href: "/admin/dashboard", label: "Dashboard" },
  { section: "Students", href: "/admin/students", label: "Students" },
  { section: "Students", href: "/admin/results", label: "Results" },
  { section: "Learning content", href: "/admin/crud/grades", label: "Grades" },
  { section: "Learning content", href: "/admin/crud/subjects", label: "Subjects" },
  { section: "Learning content", href: "/admin/crud/chapters", label: "Chapters" },
  { section: "Learning content", href: "/admin/crud/topics", label: "Topics" },
  { section: "Learning content", href: "/admin/crud/notes", label: "Notes" },
  { section: "Learning content", href: "/admin/crud/questions", label: "Questions" },
  { section: "Learning content", href: "/admin/import", label: "Import questions" },
  { section: "Learning content", href: "/admin/crud/exams", label: "Exams" },
  { section: "Billing", href: "/admin/payments", label: "Payments" },
  { section: "Communication", href: "/admin/crud/announcements", label: "Notices" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) redirect("/login");

  return <AdminNav links={links} admin={{ name: admin.name, email: admin.email }}>{children}</AdminNav>;
}
