import { eq } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { communityCountries, users, type UserRole } from "../db/schema";
import {
  buildAuthorizeUrl,
  exchangeCode,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
  getAuthCallbackUrl,
  getCookie,
  sanitizeReturnTo,
  validateIdToken,
} from "./oidc";
import {
  createSession,
  isSecure,
  readSessionToken,
  sessionCookie,
  validateSession,
  type AuthUser,
} from "./session";

const DEV_USER_ID = "dev-effect-latam";

export function envFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".localhost");
}

export function shouldUseDevAuth(request: Request, env: Env): boolean {
  if (!envFlag(env.EFFECT_LATAM_DEV_AUTH ?? "0")) return false;
  if (!env.DB) return false;
  return isLocalHost(new URL(request.url).hostname);
}

function parseEmailList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function roleForEmail(email: string, env: Env): UserRole {
  const admins = parseEmailList(env.EFFECT_LATAM_ADMIN_EMAILS);
  return admins.has(email.trim().toLowerCase()) ? "staff" : "member";
}

export async function ensureDevUser(db: Db): Promise<AuthUser> {
  const existing = await db.select().from(users).where(eq(users.id, DEV_USER_ID)).limit(1);
  if (existing[0]) return existing[0];
  const now = new Date();
  const row = {
    id: DEV_USER_ID,
    email: "dev@effect-latam.local",
    name: "Dev Learner",
    avatarUrl: null as string | null,
    username: "devlearner",
    countryCode: "UY",
    role: "staff" as const,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(users).values(row);
  return row;
}

export async function resolveAuth(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser; db: Db } | null> {
  if (!env.DB) return null;
  const db = getDb(env.DB);
  const token = readSessionToken(request);
  if (token) {
    const session = await validateSession(db, token);
    if (session) return { user: session.user, db };
  }
  return null;
}

export async function requireAuth(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser; db: Db } | Response> {
  const auth = await resolveAuth(request, env);
  if (!auth) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  return auth;
}

export async function loginDev(request: Request, env: Env): Promise<Response> {
  if (!shouldUseDevAuth(request, env) || !env.DB) {
    return Response.json({ error: "dev auth disabled" }, { status: 403 });
  }
  const db = getDb(env.DB);
  const user = await ensureDevUser(db);
  if (user.countryCode) {
    await db
      .insert(communityCountries)
      .values({
        code: user.countryCode,
        firstRegisteredAt: new Date(),
      })
      .onConflictDoNothing();
  }
  const token = await createSession(db, user.id);
  const secure = isSecure(request);
  const returnTo = sanitizeReturnTo(new URL(request.url).searchParams.get("returnTo") || "/");
  const headers = new Headers({ Location: returnTo });
  headers.append("Set-Cookie", sessionCookie(token, secure));
  return new Response(null, { status: 302, headers });
}

/** Start OIDC authorization code + PKCE flow (production path). */
export async function loginOidc(request: Request, env: Env): Promise<Response> {
  if (!env.EFFECT_LATAM_CLIENT_SECRET) {
    return Response.json(
      { error: "oidc_not_configured", message: "EFFECT_LATAM_CLIENT_SECRET missing" },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo") || "/");
  const requestedPrompt = url.searchParams.get("prompt");
  const prompt =
    requestedPrompt === "none" ||
    requestedPrompt === "login" ||
    requestedPrompt === "select_account"
      ? requestedPrompt
      : "select_account";
  const secure = isSecure(request);

  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const authorizeUrl = buildAuthorizeUrl({
    env,
    state,
    nonce,
    codeChallenge,
    redirectUri: getAuthCallbackUrl(request, env.APP_URL),
    prompt,
  });

  const cookieFlags = `HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure ? "; Secure" : ""}`;
  const headers = new Headers({ Location: authorizeUrl });
  headers.append("Set-Cookie", `oidc_state=${state}; ${cookieFlags}`);
  headers.append("Set-Cookie", `oidc_nonce=${nonce}; ${cookieFlags}`);
  headers.append("Set-Cookie", `oidc_code_verifier=${codeVerifier}; ${cookieFlags}`);
  headers.append("Set-Cookie", `oidc_return_to=${encodeURIComponent(returnTo)}; ${cookieFlags}`);
  return new Response(null, { status: 302, headers });
}

function clearOidcCookies(headers: Headers, secure: boolean): void {
  const clearFlags = `HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
  headers.append("Set-Cookie", `oidc_state=; ${clearFlags}`);
  headers.append("Set-Cookie", `oidc_nonce=; ${clearFlags}`);
  headers.append("Set-Cookie", `oidc_code_verifier=; ${clearFlags}`);
  headers.append("Set-Cookie", `oidc_return_to=; ${clearFlags}`);
}

/** OIDC callback: exchange code, upsert user, set session cookie. */
export async function handleOidcCallback(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return Response.json({ error: "db_unavailable" }, { status: 503 });
  }
  const url = new URL(request.url);
  const secure = isSecure(request);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const savedState = getCookie(request, "oidc_state");
  const returnTo = sanitizeReturnTo(getCookie(request, "oidc_return_to") || "/");

  if (!savedState || state !== savedState) {
    return Response.json({ error: "invalid_oauth_state" }, { status: 400 });
  }

  if (error === "login_required") {
    const loginUrl = `/api/auth/login?prompt=login&returnTo=${encodeURIComponent(returnTo)}`;
    const headers = new Headers({ Location: loginUrl });
    clearOidcCookies(headers, secure);
    return new Response(null, { status: 302, headers });
  }

  if (error) {
    console.warn("[effect-latam] oidc error", error, url.searchParams.get("error_description"));
    const headers = new Headers();
    clearOidcCookies(headers, secure);
    return Response.json({ error: "auth_error", detail: error }, { status: 400, headers });
  }

  if (!code) {
    return Response.json({ error: "missing_code" }, { status: 400 });
  }

  const nonce = getCookie(request, "oidc_nonce");
  const codeVerifier = getCookie(request, "oidc_code_verifier");
  if (!nonce || !codeVerifier) {
    return Response.json({ error: "oidc_cookies_expired" }, { status: 400 });
  }

  try {
    const idToken = await exchangeCode(
      env,
      code,
      codeVerifier,
      getAuthCallbackUrl(request, env.APP_URL),
    );
    const claims = await validateIdToken(env, idToken, nonce);
    if (claims.email_verified !== true) {
      const headers = new Headers();
      clearOidcCookies(headers, secure);
      return Response.json({ error: "email_unverified" }, { status: 403, headers });
    }

    const role = roleForEmail(claims.email, env);
    const db = getDb(env.DB);
    const now = new Date();

    await db
      .insert(users)
      .values({
        id: claims.sub,
        email: claims.email,
        name: claims.name || null,
        avatarUrl: claims.picture || null,
        username: null,
        countryCode: null,
        role,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: claims.email,
          name: claims.name || null,
          avatarUrl: claims.picture || null,
          role,
          updatedAt: now,
        },
      });

    const sessionToken = await createSession(db, claims.sub);
    const [userRecord] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);

    const destination =
      userRecord?.username != null ? returnTo : `/perfil?returnTo=${encodeURIComponent(returnTo)}`;

    const headers = new Headers({ Location: destination });
    headers.append("Set-Cookie", sessionCookie(sessionToken, secure));
    clearOidcCookies(headers, secure);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error("[effect-latam] oidc callback failed", err);
    const headers = new Headers();
    clearOidcCookies(headers, secure);
    return Response.json({ error: "auth_failed" }, { status: 500, headers });
  }
}

/** Login entry: local dev shortcut or OIDC authorize redirect. */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (shouldUseDevAuth(request, env)) {
    return loginDev(request, env);
  }
  return loginOidc(request, env);
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    username: user.username,
    countryCode: user.countryCode,
    role: user.role,
  };
}
