import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "./config";

export const SESSION_COOKIE = "admin_session";

type SessionPayload = { sub: number; name: string; email: string };

function key(): Uint8Array {
  return new TextEncoder().encode(config.auth.secret);
}

export async function createSessionToken(
  user: { id: number; name: string; email: string },
): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub) return null;
    return {
      sub: Number(payload.sub),
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
    };
  } catch {
    return null;
  }
}

/** The authenticated admin for a server component / route handler, or null. */
export async function getAdmin(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export class ApiError extends Error {
  status: number;
  extra?: Record<string, string[]>;

  constructor(status: number, message: string, extra?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Throws a 401 ApiError when there is no valid admin session. */
export async function requireAdmin(): Promise<SessionPayload> {
  const admin = await getAdmin();
  if (!admin) throw new ApiError(401, "Unauthenticated.");
  return admin;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { message: error.message, errors: error.extra },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Server error";
  console.error("[api]", error);
  return NextResponse.json({ message }, { status: 500 });
}

/** Bearer/secret gate for cron + other machine endpoints. */
export function requireCronSecret(request: Request): void {
  const secret = config.cronSecret;
  if (!secret) throw new ApiError(503, "CRON_SECRET is not configured.");
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) throw new ApiError(403, "Invalid cron secret.");
}
