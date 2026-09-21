import { MAX_MUTATION_BYTES, readJsonBody } from "./body";
import { handleForumApi } from "./forums";
import { eq } from "drizzle-orm";
import { listNotifications, markRead } from "../vendor/social/server/notifications";
import { evaluateAfterEvent, recordEvent } from "../vendor/social/achievements/events";
import { listUserAchievements } from "../vendor/social/achievements/server";
import {
  handleLogin,
  handleOidcCallback,
  publicUser,
  requireAuth,
  resolveAuth,
} from "../auth/resolve";
import { clearSessionCookie, destroySession, isSecure, readSessionToken } from "../auth/session";
import { asSocialDb, getDb } from "../db";
import { communityCountries, learnVisits, users } from "../db/schema";
import { decide } from "../entitlements/catalog";
import { FORUMS } from "../forums/registry";
import { buildElRegistry } from "../achievements/catalog";
import { isCountryCode } from "../lib/countries";
import { LABS } from "../learn/catalog";
import { abuseAction, enforceAbuseLimit } from "../security/abuse";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const MAX_NOTIFICATION_IDS = 100;
const LESSON_IDS = new Set(LABS.map((lab) => lab.id));
const registry = buildElRegistry();

export async function handleApiRoute(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (!pathname.startsWith("/api/")) return undefined;

  if (isMutation(request.method)) {
    const origin = request.headers.get("Origin");
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if ((origin && origin !== url.origin) || fetchSite === "cross-site") {
      return Response.json({ error: "cross_origin_request" }, { status: 403 });
    }
    const contentLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MUTATION_BYTES) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
  }

  // Public lab visits are a no-op; charge their IP only when progress is saved.
  if (abuseAction(request) !== "learn") {
    const limited = await enforceAbuseLimit(request, env);
    if (limited) return limited;
  }

  // ── Auth ──────────────────────────────────────────────
  if (pathname === "/api/auth/login" && request.method === "GET") {
    // Localhost + EFFECT_LATAM_DEV_AUTH → instant dev user; else OIDC.
    return handleLogin(request, env);
  }
  if (pathname === "/api/auth/callback" && request.method === "GET") {
    return handleOidcCallback(request, env);
  }
  if (pathname === "/api/auth/me" && request.method === "GET") {
    const auth = await resolveAuth(request, env);
    const body = auth
      ? {
          authenticated: true,
          profile: publicUser(auth.user),
        }
      : { authenticated: false };
    return Response.json(body, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  }
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    if (env.DB) {
      const token = readSessionToken(request);
      if (token) await destroySession(getDb(env.DB), token);
    }
    const headers = new Headers({ Location: "/" });
    headers.append("Set-Cookie", clearSessionCookie(isSecure(request)));
    return new Response(null, { status: 302, headers });
  }
  if (pathname === "/api/auth/logout") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  if (pathname === "/api/auth/profile" && request.method === "PATCH") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const limited = await enforceAbuseLimit(request, env, auth.user.id);
    if (limited) return limited;
    const decision = decide(auth.user, "profile.update");
    if (!decision.allowed) {
      return Response.json({ error: "forbidden", denials: decision.denials }, { status: 403 });
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as {
      username?: string;
      countryCode?: string | null;
      name?: string;
    };
    const patch: {
      username?: string;
      countryCode?: string | null;
      name?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (body.username !== undefined) {
      if (typeof body.username !== "string") {
        return Response.json({ error: "invalid_username" }, { status: 400 });
      }
      const u = body.username.trim().toLowerCase();
      if (!USERNAME_RE.test(u)) {
        return Response.json({ error: "invalid_username" }, { status: 400 });
      }
      patch.username = u;
    }
    if (body.countryCode !== undefined) {
      if (body.countryCode !== null && typeof body.countryCode !== "string") {
        return Response.json({ error: "invalid_country" }, { status: 400 });
      }
      if (body.countryCode !== null && !isCountryCode(body.countryCode)) {
        return Response.json({ error: "invalid_country" }, { status: 400 });
      }
      patch.countryCode = body.countryCode ? body.countryCode.toUpperCase() : null;
    }
    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return Response.json({ error: "invalid_name" }, { status: 400 });
      }
      patch.name = body.name.trim().slice(0, 80);
    }

    try {
      await auth.db.update(users).set(patch).where(eq(users.id, auth.user.id));
    } catch (error) {
      if (error instanceof Error && /unique|constraint/i.test(error.message)) {
        return Response.json({ error: "username_taken" }, { status: 409 });
      }
      console.error("[effect-latam] profile update failed", error);
      return Response.json({ error: "profile_update_failed" }, { status: 500 });
    }

    if (patch.countryCode) {
      await auth.db
        .insert(communityCountries)
        .values({
          code: patch.countryCode,
          firstRegisteredAt: new Date(),
        })
        .onConflictDoNothing();
      const sdb = asSocialDb(auth.db);
      await recordEvent(sdb, {
        id: `account.country.set:${auth.user.id}:${patch.countryCode}`,
        userId: auth.user.id,
        type: "account.country.set",
        payload: { code: patch.countryCode },
      });
      await evaluateAfterEvent(
        sdb,
        registry,
        {
          id: `account.country.set:${auth.user.id}:${patch.countryCode}`,
          userId: auth.user.id,
          type: "account.country.set",
          payload: { code: patch.countryCode },
        },
        { notify: true, notificationHref: "/logros" },
      );
    }
    if (patch.username) {
      const sdb = asSocialDb(auth.db);
      await recordEvent(sdb, {
        id: `account.username.set:${auth.user.id}`,
        userId: auth.user.id,
        type: "account.username.set",
        payload: { username: patch.username },
      });
      await evaluateAfterEvent(
        sdb,
        registry,
        {
          id: `account.username.set:${auth.user.id}`,
          userId: auth.user.id,
          type: "account.username.set",
          payload: { username: patch.username },
        },
        { notify: true, notificationHref: "/logros" },
      );
    }

    const [fresh] = await auth.db.select().from(users).where(eq(users.id, auth.user.id)).limit(1);
    return Response.json({ ok: true, profile: publicUser(fresh!) });
  }

  // ── Community ─────────────────────────────────────────
  if (pathname === "/api/community/countries" && request.method === "GET") {
    if (!env.DB) return Response.json({ ok: true, codes: ["UY"] });
    const db = getDb(env.DB);
    const rows = await db.select().from(communityCountries);
    const codes = rows.map((r) => r.code).sort();
    return Response.json({ ok: true, codes });
  }

  // ── Learn visits ──────────────────────────────────────
  if (pathname === "/api/learn/visit" && request.method === "POST") {
    // Progress is optional for guests. A no-op avoids turning a normal public
    // lab visit into a noisy browser error while preserving authenticated data.
    const auth = await resolveAuth(request, env);
    if (!auth) {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const ipLimited = await enforceAbuseLimit(request, env);
    if (ipLimited) return ipLimited;
    const accountLimited = await enforceAbuseLimit(request, env, auth.user.id);
    if (accountLimited) return accountLimited;
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as { lessonId?: string };
    if (typeof body.lessonId !== "string") {
      return Response.json({ error: "invalid_lesson" }, { status: 400 });
    }
    const lessonId = (body.lessonId ?? "").trim();
    if (!LESSON_IDS.has(lessonId)) {
      return Response.json({ error: "invalid_lesson" }, { status: 400 });
    }
    await auth.db
      .insert(learnVisits)
      .values({
        userId: auth.user.id,
        lessonId,
        visitedAt: new Date(),
      })
      .onConflictDoNothing();
    const eventId = `learn.lab.visited:${auth.user.id}:${lessonId}`;
    const sdb = asSocialDb(auth.db);
    await recordEvent(sdb, {
      id: eventId,
      userId: auth.user.id,
      type: "learn.lab.visited",
      payload: { lessonId },
    });
    const unlocked = await evaluateAfterEvent(
      sdb,
      registry,
      {
        id: eventId,
        userId: auth.user.id,
        type: "learn.lab.visited",
        payload: { lessonId },
      },
      { notify: true, notificationHref: "/logros" },
    );
    return Response.json({
      ok: true,
      unlocked: unlocked.map((u) => u.achievementId),
    });
  }

  // ── Achievements ──────────────────────────────────────
  if (pathname === "/api/achievements" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const list = await listUserAchievements(asSocialDb(auth.db), registry, auth.user.id);
    return Response.json({ ok: true, achievements: list });
  }

  // ── Forums ────────────────────────────────────────────
  if (pathname === "/api/forums" && request.method === "GET") {
    return Response.json({ ok: true, forums: FORUMS });
  }

  if (pathname.startsWith("/api/forum/")) {
    return handleForumApi(request, env, pathname, registry);
  }

  // ── Notifications ─────────────────────────────────────
  if (pathname === "/api/notifications" && request.method === "GET") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const items = await listNotifications(asSocialDb(auth.db), auth.user.id, { limit: 30 });
    return Response.json({ ok: true, notifications: items });
  }
  if (pathname === "/api/notifications/read" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const limited = await enforceAbuseLimit(request, env, auth.user.id);
    if (limited) return limited;
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as { ids?: string[] };
    if (
      body.ids !== undefined &&
      (!Array.isArray(body.ids) ||
        body.ids.length > MAX_NOTIFICATION_IDS ||
        body.ids.some((id) => typeof id !== "string" || id.length === 0 || id.length > 128))
    ) {
      return Response.json({ error: "invalid_notification_ids" }, { status: 400 });
    }
    await markRead(asSocialDb(auth.db), auth.user.id, body.ids);
    return Response.json({ ok: true });
  }

  // ── Public profile ────────────────────────────────────
  if (pathname.startsWith("/api/users/") && request.method === "GET") {
    if (!env.DB) return Response.json({ error: "not_found" }, { status: 404 });
    let username: string;
    try {
      username = decodeURIComponent(pathname.slice("/api/users/".length)).toLowerCase();
    } catch {
      return Response.json({ error: "invalid_username" }, { status: 400 });
    }
    if (!USERNAME_RE.test(username)) {
      return Response.json({ error: "invalid_username" }, { status: 400 });
    }
    const db = getDb(env.DB);
    const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    const achievements = await listUserAchievements(asSocialDb(db), registry, row.id);
    return Response.json({
      ok: true,
      profile: {
        username: row.username,
        name: row.name,
        countryCode: row.countryCode,
        avatarUrl: row.avatarUrl,
      },
      achievements,
    });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
