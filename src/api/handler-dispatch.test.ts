import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleApiRoute } from "./handler";
import { enforceAbuseLimit } from "../security/abuse";

vi.mock("../security/abuse", async (importOriginal) => {
  const original = await importOriginal<typeof import("../security/abuse")>();
  return { ...original, enforceAbuseLimit: vi.fn() };
});

const admission = vi.mocked(enforceAbuseLimit);
const env = {} as Env;

beforeEach(() => {
  admission.mockReset();
  admission.mockResolvedValue(undefined);
});

describe("API dispatch boundaries", () => {
  test("leaves page requests to the renderer without charging API limits", async () => {
    const response = await handleApiRoute(new Request("https://effectlatam.com/foros"), env);

    expect(response).toBeUndefined();
    expect(admission).not.toHaveBeenCalled();
  });

  test.each(["/api/unknown", "/api/forum/unknown"])("returns JSON 404 for %s", async (path) => {
    const response = await handleApiRoute(new Request(`https://effectlatam.com${path}`), env);

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "not_found" });
  });

  test("rejects a delegated cross-origin mutation before admission or body parsing", async () => {
    const request = new Request("https://effectlatam.com/api/forum/threads", {
      method: "POST",
      headers: { Origin: "https://attacker.invalid", "Content-Length": "65537" },
      body: "{",
    });
    const response = await handleApiRoute(request, env);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "cross_origin_request" });
    expect(admission).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  test("rejects a delegated oversized mutation before admission or body parsing", async () => {
    const request = new Request("https://effectlatam.com/api/forum/threads", {
      method: "POST",
      headers: { Origin: "https://effectlatam.com", "Content-Length": "65537" },
      body: "{",
    });
    const response = await handleApiRoute(request, env);

    expect(response?.status).toBe(413);
    await expect(response?.json()).resolves.toEqual({ error: "payload_too_large" });
    expect(admission).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  test("preserves IP admission denial before delegated authentication", async () => {
    admission.mockResolvedValueOnce(
      Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const request = new Request("https://effectlatam.com/api/forum/threads", {
      method: "POST",
      body: "{",
    });
    const response = await handleApiRoute(request, env);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(admission).toHaveBeenCalledExactlyOnceWith(request, env);
    expect(request.bodyUsed).toBe(false);
  });

  test.each(["/api/forum/threads", "/api/forum/threads/example/posts", "/api/forum/reports"])(
    "keeps anonymous denial ahead of body parsing for %s",
    async (path) => {
      const request = new Request(`https://effectlatam.com${path}`, { method: "POST", body: "{" });
      const response = await handleApiRoute(request, env);

      expect(response?.status).toBe(401);
      await expect(response?.json()).resolves.toEqual({ error: "unauthenticated" });
      expect(admission).toHaveBeenCalledExactlyOnceWith(request, env);
      expect(request.bodyUsed).toBe(false);
    },
  );

  test("keeps anonymous Learn visits exempt from admission and body parsing", async () => {
    const request = new Request("https://effectlatam.com/api/learn/visit", {
      method: "POST",
      body: "{",
    });
    const response = await handleApiRoute(request, env);

    expect(response?.status).toBe(204);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(admission).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });
});
