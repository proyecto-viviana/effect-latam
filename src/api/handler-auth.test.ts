import { describe, expect, test } from "vitest";
import { handleApiRoute } from "./handler";
import { readJsonBody } from "./body";

describe("auth API", () => {
  test("returns an explicitly uncacheable unauthenticated state", async () => {
    const response = await handleApiRoute(
      new Request("https://effectlatam.com/api/auth/me"),
      {} as Env,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ authenticated: false });
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(response?.headers.get("vary")).toBe("Cookie");
  });

  test("only allows logout over POST", async () => {
    const response = await handleApiRoute(
      new Request("https://effectlatam.com/api/auth/logout"),
      {} as Env,
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("POST");
  });

  test("rejects a cross-origin mutation", async () => {
    const response = await handleApiRoute(
      new Request("https://effectlatam.com/api/auth/logout", {
        method: "POST",
        headers: { Origin: "https://attacker.invalid" },
      }),
      {} as Env,
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "cross_origin_request" });
  });

  test("rejects a declared oversized mutation before routing", async () => {
    const response = await handleApiRoute(
      new Request("https://effectlatam.com/api/auth/logout", {
        method: "POST",
        headers: { "Content-Length": String(64 * 1024 + 1) },
      }),
      {} as Env,
    );

    expect(response?.status).toBe(413);
  });

  test("clears the session cookie on a same-origin POST", async () => {
    const response = await handleApiRoute(
      new Request("https://effectlatam.com/api/auth/logout", {
        method: "POST",
        headers: { Origin: "https://effectlatam.com" },
      }),
      {} as Env,
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/");
    expect(response?.headers.get("set-cookie")).toContain("session=;");
  });

  test("treats a guest lab visit as optional progress", async () => {
    const response = await handleApiRoute(
      new Request("https://effectlatam.com/api/learn/visit", {
        method: "POST",
        headers: {
          Origin: "https://effectlatam.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ lessonId: "i01" }),
      }),
      {} as Env,
    );

    expect(response?.status).toBe(204);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("bounded JSON request bodies", () => {
  test("rejects a body over the byte limit even without Content-Length", async () => {
    const result = await readJsonBody(
      new Request("https://effectlatam.com/api/test", {
        method: "POST",
        body: JSON.stringify({ value: "x".repeat(64 * 1024) }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  test("rejects malformed and non-object JSON", async () => {
    for (const body of ["{", "[]", "null"]) {
      const result = await readJsonBody(
        new Request("https://effectlatam.com/api/test", { method: "POST", body }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(400);
    }
  });
});
