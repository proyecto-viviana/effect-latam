/** Host admission policy. Limits apply to attempts, including invalid writes. */
export const ABUSE_WINDOW_SECONDS = 10 * 60;
export const ABUSE_POLICIES = {
  login: { ip: 30 },
  callback: { ip: 60 },
  profile: { ip: 60, account: 20 },
  learn: { ip: 240, account: 120 },
  thread: { ip: 60, account: 20 },
  reply: { ip: 180, account: 60 },
  report: { ip: 60, account: 15 },
  notifications: { ip: 240, account: 120 },
} as const;

type Action = keyof typeof ABUSE_POLICIES;
type Scope = "ip" | "account";
type Admission = { allowed: true } | { allowed: false; retryAfter: number };

export function abuseAction(request: Request): Action | undefined {
  const path = new URL(request.url).pathname;
  if (request.method === "GET") {
    if (path === "/api/auth/login") return "login";
    if (path === "/api/auth/callback") return "callback";
  }
  if (request.method === "PATCH" && path === "/api/auth/profile") return "profile";
  if (request.method !== "POST") return undefined;
  if (path === "/api/learn/visit") return "learn";
  if (path === "/api/forum/threads") return "thread";
  if (/^\/api\/forum\/threads\/[^/]+\/posts$/.test(path)) return "reply";
  if (path === "/api/forum/reports") return "report";
  if (path === "/api/notifications/read") return "notifications";
  // Never make clearing a session depend on admission-control availability.
  return undefined;
}

/** Only Cloudflare's ingress metadata/header pair is trusted in production. */
export function trustedClientIp(request: Request): string | undefined {
  const hostname = new URL(request.url).hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  ) {
    // No per-header identities or bypass flags on the local Worker either.
    return "local";
  }
  const cf = (request as Request & { cf?: unknown }).cf;
  if (!cf || typeof cf !== "object") return undefined;
  const address = request.headers.get("CF-Connecting-IP");
  if (!address || address.length > 45) return undefined;
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) {
    return address.split(".").every((part) => Number(part) <= 255) ? address : undefined;
  }
  if (!/^[0-9a-f:]+$/i.test(address) || !address.includes(":")) return undefined;
  try {
    return new URL(`http://[${address}]`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
}

type Window = { startedAt: number; key: CryptoKey };
const windowsByRequest = new WeakMap<Request, Promise<Window>>();
const encoder = new TextEncoder();

async function loadWindow(db: D1Database, nowSeconds: number): Promise<Window> {
  const startedAt = Math.floor(nowSeconds / ABUSE_WINDOW_SECONDS) * ABUSE_WINDOW_SECONDS;
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const proposedSecret = Array.from(entropy, (byte) => byte.toString(16).padStart(2, "0")).join("");
  // UPSERT selects the same random key across concurrent isolates. The no-op
  // update lets RETURNING work for the existing window without a read race.
  const row = await db
    .prepare(
      `INSERT INTO abuse_windows (started_at, secret, expires_at) VALUES (?, ?, ?)
       ON CONFLICT (started_at) DO UPDATE SET started_at = excluded.started_at
       RETURNING secret`,
    )
    .bind(startedAt, proposedSecret, startedAt + ABUSE_WINDOW_SECONDS)
    .first<{ secret: string }>();
  if (!row) throw new Error("Missing admission-control window");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(row.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { startedAt, key };
}

/** One atomic conditional UPSERT admits at most `limit` requests per bucket. */
export async function consumeAbuseLimit(
  db: D1Database,
  request: Request,
  action: Action,
  scope: Scope,
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Admission> {
  const policy = ABUSE_POLICIES[action];
  const limit = scope === "ip" ? policy.ip : "account" in policy ? policy.account : undefined;
  if (limit === undefined) return { allowed: true };
  let pendingWindow = windowsByRequest.get(request);
  if (!pendingWindow) {
    pendingWindow = loadWindow(db, nowSeconds);
    windowsByRequest.set(request, pendingWindow);
  }
  const window = await pendingWindow;
  const signature = await crypto.subtle.sign(
    "HMAC",
    window.key,
    encoder.encode(JSON.stringify([action, scope, subject])),
  );
  const bucket = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const admitted = await db
    .prepare(
      `INSERT INTO abuse_counters (window_start, bucket, hits) VALUES (?, ?, 1)
       ON CONFLICT (window_start, bucket) DO UPDATE SET hits = hits + 1
       WHERE hits < ? RETURNING hits`,
    )
    .bind(window.startedAt, bucket, limit)
    .first<{ hits: number }>();
  return admitted
    ? { allowed: true }
    : {
        allowed: false,
        retryAfter: Math.max(1, window.startedAt + ABUSE_WINDOW_SECONDS - nowSeconds),
      };
}

/** IP admission precedes auth lookup; account admission follows validated auth. */
export async function enforceAbuseLimit(
  request: Request,
  env: Env,
  accountId?: string,
): Promise<Response | undefined> {
  const action = abuseAction(request);
  if (!action) return undefined;
  const scope: Scope = accountId === undefined ? "ip" : "account";
  if (scope === "account" && !("account" in ABUSE_POLICIES[action])) return undefined;
  const subject = accountId ?? trustedClientIp(request);
  try {
    if (!env.DB || !subject) throw new Error("Admission control unavailable");
    const result = await consumeAbuseLimit(env.DB, request, action, scope, subject);
    if (result.allowed) return undefined;
    console.warn({ event: "abuse_control", action, scope, result: "denied" });
    return Response.json(
      { error: "rate_limited", retryAfter: result.retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfter),
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    // Do not log the D1 error: it may include bound values or SQL context.
    console.error({ event: "abuse_control", action, scope, result: "unavailable" });
    return Response.json(
      { error: "temporarily_unavailable" },
      {
        status: 503,
        headers: { "Retry-After": "30", "Cache-Control": "private, no-store" },
      },
    );
  }
}
