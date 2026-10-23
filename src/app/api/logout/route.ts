import { NextResponse } from "next/server";
import { SESSION_COOKIE, errorResponse } from "@/lib/auth";

/** POST /api/logout — clears the admin session cookie. */
export async function POST() {
  try {
    const response = NextResponse.json({ message: "Logged out." });
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
