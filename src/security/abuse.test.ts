import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { handleApiRoute } from "../api/handler";
import {
  ABUSE_POLICIES,
  ABUSE_WINDOW_SECONDS,
  abuseAction,
  consumeAbuseLimit,
  enforceAbuseLimit,
  trustedClientIp,
} from "./abuse";

// Execute production migration and prepared SQL in real SQLite. This adapter
// only translates D1's first() shape; it does not implement limiter behavior.
let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(new URL("../../drizzle/0001_abuse_controls.sql", import.meta.url), "utf8"),
  );
  db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values: SQLInputValue[]) {
          return {
            first: async () => statement.get(...values) ?? null,
            raw: async () => {
              statement.setReturnArrays(true);
              return statement.all(...values);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
});
afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

function request(path = "/api/forum/threads", method = "POST") {
  return new Request(`http://localhost${path}`, { method });
}

function edgeRequest(address: string, extraHeaders: Record<string, string> = {}) {
  const incoming = new Request("https://effectlatam.com/api/auth/login", {
    headers: { "CF-Connecting-IP": address, ...extraHeaders },
  });
  Object.defineProperty(incoming, "cf", { value: { colo: "TEST" } });
  return incoming;
}

describe("trusted network identity", () => {
  test("uses Cloudflare ingress and ignores user forwarding headers", () => {
    expect(
      trustedClientIp(
        edgeRequest("203.0.113.1", {
          "X-Forwarded-For": "198.51.100.5",
          "X-Real-IP": "198.51.100.6",
          "True-Client-IP": "198.51.100.7",
        }),
      ),
    ).toBe("203.0.113.1");
    expect(
      trustedClientIp(
        new Request("https://effectlatam.com/api/auth/login", {
          headers: { "CF-Connecting-IP": "203.0.113.1", "CF-Ray": "forged" },
        }),
      ),
    ).toBeUndefined();
  });

  test("rejects malformed addresses and canonicalizes IPv6 spellings", () => {
    for (const address of ["", "999.0.0.1", "01.0.0.1", "203.0.113.1, 198.51.100.5", ":::"]) {
      expect(trustedClientIp(edgeRequest(address))).toBeUndefined();
    }
    expect(trustedClientIp(edgeRequest("2001:0DB8:0000:0000:0000:0000:0000:0001"))).toBe(
      "2001:db8::1",
    );
  });

  test("local requests share an identity regardless of supplied headers", () => {
    expect(trustedClientIp(request())).toBe("local");
    expect(
      trustedClientIp(
        new Request("http://localhost/api/auth/login", {
          headers: { "CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "198.51.100.1" },
        }),
      ),
    ).toBe("local");
  });
});

describe("atomic shared abuse counters", () => {
  test("every policy admits its exact allowance and denies the next attempt", async () => {
    for (const action of Object.keys(ABUSE_POLICIES) as (keyof typeof ABUSE_POLICIES)[]) {
      const policy = ABUSE_POLICIES[action];
      for (const scope of ["ip", "account"] as const) {
        const limit = scope === "ip" ? policy.ip : "account" in policy ? policy.account : 0;
        if (!limit) continue;
        for (let n = 0; n < limit; n++) {
          expect(await consumeAbuseLimit(db, request(), action, scope, "same", 1_250)).toEqual({
            allowed: true,
          });
        }
        expect(await consumeAbuseLimit(db, request(), action, scope, "same", 1_250)).toEqual({
          allowed: false,
          retryAfter: 550,
        });
      }
    }
  });

  test("concurrent requests cannot over-admit or create competing window keys", async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        consumeAbuseLimit(db, request(), "profile", "ip", "203.0.113.1", 1_201),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(ABUSE_POLICIES.profile.ip);
    expect(sqlite.prepare("SELECT count(*) AS count FROM abuse_windows").get()?.count).toBe(1);
    expect(sqlite.prepare("SELECT hits FROM abuse_counters").get()?.hits).toBe(60);
  });

  test("resets at the window boundary and prunes prior counters and keys", async () => {
    for (let n = 0; n <= ABUSE_POLICIES.login.ip; n++) {
      await consumeAbuseLimit(db, request(), "login", "ip", "203.0.113.1", 1_799);
    }
    expect(await consumeAbuseLimit(db, request(), "login", "ip", "203.0.113.1", 1_799)).toEqual({
      allowed: false,
      retryAfter: 1,
    });
    const oldBucket = sqlite.prepare("SELECT bucket FROM abuse_counters").get()?.bucket;
    expect(await consumeAbuseLimit(db, request(), "login", "ip", "203.0.113.1", 1_800)).toEqual({
      allowed: true,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM abuse_counters").get()?.count).toBe(1);
    expect(sqlite.prepare("SELECT bucket FROM abuse_counters").get()?.bucket).not.toBe(oldBucket);
    expect(sqlite.prepare("SELECT started_at FROM abuse_windows").get()?.started_at).toBe(1_800);
  });

  test("accounts, IPs, actions and subject namespaces remain independent", async () => {
    for (let n = 0; n < ABUSE_POLICIES.thread.account; n++) {
      await consumeAbuseLimit(db, request(), "thread", "account", "one", 1_250);
    }
    expect(
      (await consumeAbuseLimit(db, request(), "thread", "account", "one", 1_250)).allowed,
    ).toBe(false);
    for (const [action, scope, subject] of [
      ["thread", "account", "two"],
      ["thread", "ip", "one"],
      ["reply", "account", "one"],
    ] as const) {
      expect((await consumeAbuseLimit(db, request(), action, scope, subject, 1_250)).allowed).toBe(
        true,
      );
    }
    for (let n = 0; n < ABUSE_POLICIES.login.ip; n++) {
      await consumeAbuseLimit(db, request(), "login", "ip", "203.0.113.1", 1_250);
    }
    expect(
      (await consumeAbuseLimit(db, request(), "login", "ip", "203.0.113.2", 1_250)).allowed,
    ).toBe(true);
  });

  test("stores no raw network or account identifiers", async () => {
    await consumeAbuseLimit(db, request(), "thread", "ip", "203.0.113.42", 1_250);
    await consumeAbuseLimit(db, request(), "thread", "account", "sensitive-user-id", 1_250);
    const records = JSON.stringify(sqlite.prepare("SELECT * FROM abuse_counters").all());
    expect(records).not.toContain("203.0.113.42");
    expect(records).not.toContain("sensitive-user-id");
    expect(
      sqlite.prepare("SELECT expires_at - started_at AS duration FROM abuse_windows").get()
        ?.duration,
    ).toBe(ABUSE_WINDOW_SECONDS);
  });
});

describe("HTTP admission boundary", () => {
  test("authenticated API attempts consume account limits across changing IPs", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_250_000);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sqlite.exec(readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8"));
    for (const id of ["one", "two"]) {
      sqlite
        .prepare("INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, 1200, 1200)")
        .run(id, `${id}@example.invalid`);
      sqlite
        .prepare(
          "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 9999, 1200)",
        )
        .run(createHash("sha256").update(`session-${id}`).digest("hex"), id);
    }
    for (const [path, method, action] of [
      ["/api/auth/profile", "PATCH", "profile"],
      ["/api/learn/visit", "POST", "learn"],
      ["/api/forum/threads", "POST", "thread"],
      ["/api/forum/threads/nonexistent/posts", "POST", "reply"],
      ["/api/forum/reports", "POST", "report"],
      ["/api/notifications/read", "POST", "notifications"],
    ] as const) {
      const makeAttempt = (number: number, user = "one") => {
        const incoming = new Request(`https://effectlatam.com${path}`, {
          method,
          headers: {
            Cookie: `el_session=session-${user}`,
            "CF-Connecting-IP": `203.0.113.${number}`,
          },
          body: "{",
        });
        Object.defineProperty(incoming, "cf", { value: { colo: "TEST" } });
        return handleApiRoute(incoming, { DB: db } as Env);
      };
      for (let n = 0; n < ABUSE_POLICIES[action].account; n++) {
        expect((await makeAttempt(n))?.status).toBe(action === "reply" ? 404 : 400);
      }
      expect((await makeAttempt(200))?.status).toBe(429);
      expect((await makeAttempt(201, "two"))?.status).toBe(action === "reply" ? 404 : 400);
    }
  });

  test("covers all scoped endpoints without limiting logout or ordinary reads", () => {
    for (const [path, method, action] of [
      ["/api/auth/login", "GET", "login"],
      ["/api/auth/callback", "GET", "callback"],
      ["/api/auth/profile", "PATCH", "profile"],
      ["/api/learn/visit", "POST", "learn"],
      ["/api/forum/threads", "POST", "thread"],
      ["/api/forum/threads/abc/posts", "POST", "reply"],
      ["/api/forum/reports", "POST", "report"],
      ["/api/notifications/read", "POST", "notifications"],
    ]) {
      expect(abuseAction(request(path, method))).toBe(action);
    }
    expect(abuseAction(request("/api/auth/logout"))).toBeUndefined();
    expect(abuseAction(request("/api/forum/threads", "GET"))).toBeUndefined();
  });

  test("returns consistent 429 and retry headers, with identifier-free metrics", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_250_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let n = 0; n < ABUSE_POLICIES.login.ip; n++) {
      expect(
        await enforceAbuseLimit(request("/api/auth/login", "GET"), { DB: db } as Env),
      ).toBeUndefined();
    }
    const response = await enforceAbuseLimit(request("/api/auth/login", "GET"), { DB: db } as Env);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("550");
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response?.json()).toEqual({ error: "rate_limited", retryAfter: 550 });
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      event: "abuse_control",
      action: "login",
      scope: "ip",
      result: "denied",
    });
  });

  test("fails closed on missing binding, missing migration, or absent ingress identity", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missingSchema = new DatabaseSync(":memory:");
    const unavailable = {
      prepare: (sql: string) => missingSchema.prepare(sql),
    } as unknown as D1Database;
    for (const [incoming, env] of [
      [request(), {}],
      [request(), { DB: unavailable }],
      [new Request("https://effectlatam.com/api/auth/login"), { DB: db }],
    ] as const) {
      const response = await enforceAbuseLimit(incoming, env as Env);
      expect(response?.status).toBe(503);
      expect(response?.headers.get("Retry-After")).toBe("30");
      expect(await response?.json()).toEqual({ error: "temporarily_unavailable" });
    }
    missingSchema.close();
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/SELECT|secret|cookie|203\.0/);
  });

  test("API rejects IP abuse before auth lookup and preserves origin/body guards", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_250_000);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let n = 0; n < ABUSE_POLICIES.thread.ip; n++) {
      await consumeAbuseLimit(db, request(), "thread", "ip", "local", 1_250);
    }
    const response = await handleApiRoute(request(), { DB: db } as Env);
    expect(response?.status).toBe(429);
    expect(
      (
        await handleApiRoute(
          new Request("http://localhost/api/forum/threads", {
            method: "POST",
            headers: { Origin: "https://untrusted.invalid" },
          }),
          {} as Env,
        )
      )?.status,
    ).toBe(403);
    expect(
      (
        await handleApiRoute(
          new Request("http://localhost/api/forum/threads", {
            method: "POST",
            headers: { "Content-Length": "65537" },
          }),
          {} as Env,
        )
      )?.status,
    ).toBe(413);
  });
});
