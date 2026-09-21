import { expect, test, vi } from "vitest";

vi.mock("@tanstack/solid-start/server", () => ({
  createStartHandler: () => () => {
    throw new Error("API tests must not initialize the renderer");
  },
  defaultStreamHandler: vi.fn(),
}));

import worker from "./server-entry";

const fixtures: { path: string; init?: RequestInit; status: number; error?: string }[] = [
  { path: "/api/auth/me", status: 200 },
  { path: "/api/notifications", status: 401, error: "unauthenticated" },
  { path: "/api/achievements", status: 401, error: "unauthenticated" },
  { path: "/api/auth/logout", status: 405, error: "method_not_allowed" },
  { path: "/api/auth/logout", init: { method: "POST" }, status: 302 },
  { path: "/api/learn/visit", init: { method: "POST" }, status: 204 },
  {
    path: "/api/forum/threads",
    init: { method: "POST", headers: { Origin: "https://attacker.invalid" } },
    status: 403,
    error: "cross_origin_request",
  },
  {
    path: "/api/forum/threads",
    init: { method: "POST", headers: { "Content-Length": "65537" } },
    status: 413,
    error: "payload_too_large",
  },
  { path: "/api/unknown", status: 404, error: "not_found" },
];

test.each(fixtures)(
  "actual API $path status $status cannot be stored",
  async ({ path, init, status, error }) => {
    const response = await worker.fetch(
      new Request(`https://effectlatam.com${path}`, init),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    if (error) await expect(response.json()).resolves.toEqual({ error });
    if (status === 405) expect(response.headers.get("allow")).toBe("POST");
    if (status === 302) {
      expect(response.headers.get("location")).toBe("/");
      expect(response.headers.getSetCookie()).toHaveLength(1);
      expect(response.headers.getSetCookie()[0]).toContain("el_session=;");
    }
    if (status === 204) expect(response.body).toBeNull();
  },
);
