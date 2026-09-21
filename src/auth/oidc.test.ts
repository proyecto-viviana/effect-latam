import { describe, expect, test } from "vitest";
import { getAuthCallbackUrl, sanitizeReturnTo } from "./oidc";
import { loginOidc, shouldUseDevAuth } from "./resolve";

const env = {
  AUTH_URL: "https://auth.proyectoviviana.org",
  EFFECT_LATAM_CLIENT_ID: "effect-latam",
  EFFECT_LATAM_CLIENT_SECRET: "test-only-secret",
} as Env;

async function authorizeLocation(query = ""): Promise<URL> {
  const response = await loginOidc(
    new Request(`https://effectlatam.com/api/auth/login${query}`),
    env,
  );
  const location = response.headers.get("location");
  if (!location) throw new Error("authorization redirect missing");
  return new URL(location);
}

describe("Effect LATAM OIDC login prompt", () => {
  test("visible login defaults to Viviana account selection", async () => {
    const url = await authorizeLocation("?returnTo=/perfil");

    expect(url.origin + url.pathname).toBe("https://auth.proyectoviviana.org/authorize");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_uri")).toBe("https://effectlatam.com/api/auth/callback");
  });

  test.each([
    ["none", "none"],
    ["login", "login"],
    ["select_account", "select_account"],
  ] as const)("preserves an explicit %s prompt", async (input, expected) => {
    const url = await authorizeLocation(`?prompt=${input}`);

    expect(url.searchParams.get("prompt")).toBe(expected);
  });

  test("does not forward arbitrary prompt values", async () => {
    const url = await authorizeLocation("?prompt=consent");

    expect(url.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("OIDC redirect boundaries", () => {
  test("uses the configured application origin for the callback", () => {
    const request = new Request("https://attacker.invalid/api/auth/login");

    expect(getAuthCallbackUrl(request, "https://effectlatam.com/some/path")).toBe(
      "https://effectlatam.com/api/auth/callback",
    );
  });

  test.each([
    "https://attacker.invalid",
    "//attacker.invalid",
    "\\\\attacker.invalid",
    "/%2f%2fattacker.invalid",
    "/%5cattacker.invalid",
    "/ok\u0000bad",
  ])("rejects unsafe return path %s", (value) => {
    expect(sanitizeReturnTo(value)).toBe("/");
  });

  test("preserves a safe local path, query, and fragment", () => {
    expect(sanitizeReturnTo("/perfil?tab=logros#recientes")).toBe("/perfil?tab=logros#recientes");
  });
});

describe("development authentication gate", () => {
  const localRequest = new Request("http://localhost:4177/api/auth/login");
  const fakeDb = {} as D1Database;
  const devEnv = {
    ...env,
    DB: fakeDb,
    EFFECT_LATAM_DEV_AUTH: "1",
  } as unknown as Env;

  test("is off by default", () => {
    expect(shouldUseDevAuth(localRequest, { DB: fakeDb } as Env)).toBe(false);
  });

  test("requires both an explicit flag and localhost", () => {
    expect(shouldUseDevAuth(localRequest, devEnv)).toBe(true);
    expect(shouldUseDevAuth(new Request("https://effectlatam.com/api/auth/login"), devEnv)).toBe(
      false,
    );
  });
});
