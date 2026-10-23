import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";

export default async function Home() {
  const admin = await getAdmin();
  redirect(admin ? "/admin/dashboard" : "/login");
}
