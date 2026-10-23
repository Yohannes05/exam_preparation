import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, SESSION_COOKIE, createSessionToken } from "@/lib/auth";

/** POST /api/login — admin dashboard login, sets the session cookie. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
    };

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const errors: Record<string, string[]> = {};
    if (!email) errors.email = ["The email field is required."];
    else if (!/^[^@\s]+@[^@\s]+\.\S+$/.test(email)) errors.email = ["The email must be a valid email address."];
    if (password === "") errors.password = ["The password field is required."];
    if (Object.keys(errors).length) {
      throw new ApiError(422, "The given data was invalid.", errors);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new ApiError(422, "The given data was invalid.", {
        email: ["The provided credentials are incorrect."],
      });
    }

    const token = await createSessionToken(user);
    const response = NextResponse.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
