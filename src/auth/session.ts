import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { sessions, users } from "../db/schema";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "el_session";

export type AuthUser = typeof users.$inferSelect;

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = generateSessionToken();
  await db.insert(sessions).values({
    id: await hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function validateSession(db: Db, token: string): Promise<{ user: AuthUser } | null> {
  const sessionId = await hashToken(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (rows.length === 0) return null;
  const { session, user } = rows[0]!;
  const exp =
    session.expiresAt instanceof Date ? session.expiresAt.getTime() : Number(session.expiresAt);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  return { user };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, await hashToken(token)));
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1] ?? null;
  }
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}
