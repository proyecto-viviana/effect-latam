import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchMe, shouldShowLogin } from "./client-state";

describe("client auth state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("shows login only after an explicit unauthenticated response", () => {
    expect(shouldShowLogin(undefined)).toBe(false);
    expect(shouldShowLogin({ authenticated: false })).toBe(true);
    expect(
      shouldShowLogin({
        authenticated: true,
        profile: {
          id: "user-1",
          username: null,
          name: "Viviana",
          countryCode: null,
          role: "member",
        },
      }),
    ).toBe(false);
  });

  test("does not reuse a cached auth-state response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ authenticated: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMe()).resolves.toEqual({ authenticated: false });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", {
      cache: "no-store",
    });
  });

  test("does not interpret a service failure as a logged-out session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(fetchMe()).rejects.toThrow("Session service unavailable");
  });
});
