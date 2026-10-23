import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";

/** GET /api/me — the signed-in admin. */
export async function GET() {
  try {
    const admin = await requireAdmin();
    return NextResponse.json({ id: admin.sub, name: admin.name, email: admin.email });
  } catch (error) {
    return errorResponse(error);
  }
}
