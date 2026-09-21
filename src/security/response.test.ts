import { describe, expect, test } from "vitest";
import { handleOidcCallback, loginOidc } from "../auth/resolve";
import { finalizeResponse } from "./response";

const request = new Request("https://effectlatam.com/api/notifications");

describe("API response caching", () => {
  test.each([
    [undefined, "Cookie"],
    ["Accept-Encoding", "Accept-Encoding, Cookie"],
    ["Accept-Encoding, cOoKiE", "Accept-Encoding, cOoKiE"],
    ["*", "*"],
  ])("preserves Vary %s while excluding API storage", (vary, expected) => {
    const original = new Response(null, {
      headers: {
        "Cache-Control": "public, max-age=600",
        ...(vary === undefined ? {} : { Vary: vary }),
      },
    });

    const result = finalizeResponse(request, original);

    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toBe(expected);
    expect(original.headers.get("cache-control")).toBe("public, max-age=600");
  });

  test("preserves non-API caching and existing security headers", () => {
    const result = finalizeResponse(
      new Request("https://effectlatam.com/api-reference"),
      new Response("public page", {
        headers: { "Cache-Control": "public, max-age=600", Vary: "Accept-Encoding" },
      }),
    );

    expect(result.headers.get("cache-control")).toBe("public, max-age=600");
    expect(result.headers.get("vary")).toBe("Accept-Encoding");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("x-frame-options")).toBe("DENY");
    expect(result.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(
      finalizeResponse(new Request("http://localhost/api/auth/me"), new Response()).headers.has(
        "strict-transport-security",
      ),
    ).toBe(false);
  });
});

describe("response preservation", () => {
  test("accepts an immutable redirect response", () => {
    const original = Response.redirect("https://effectlatam.com/perfil", 302);
    expect(() => original.headers.set("test", "value")).toThrow();

    const result = finalizeResponse(request, original);

    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("https://effectlatam.com/perfil");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.body).toBeNull();
  });

  test("accepts an immutable fetch response without losing its body", async () => {
    const original = await fetch("data:text/plain,synthetic%20response");
    expect(() => original.headers.set("test", "value")).toThrow();

    const result = finalizeResponse(request, original);

    expect(result.status).toBe(original.status);
    expect(result.statusText).toBe(original.statusText);
    expect(result.headers.get("content-type")).toBe("text/plain");
    await expect(result.text()).resolves.toBe("synthetic response");
  });

  test("preserves separate cookies, including Expires commas, and response metadata", () => {
    const cookies = [
      "el_session=synthetic; HttpOnly; SameSite=Lax; Path=/",
      "oidc_state=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
      "oidc_nonce=; Max-Age=0; Path=/",
      "oidc_code_verifier=; Max-Age=0; Path=/",
      "oidc_return_to=; Max-Age=0; Path=/",
    ];
    const headers = new Headers({ Location: "/perfil", Allow: "POST", "Retry-After": "30" });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);

    const result = finalizeResponse(
      request,
      new Response(null, { status: 302, statusText: "Continue sign-in", headers }),
    );

    expect(result.status).toBe(302);
    expect(result.statusText).toBe("Continue sign-in");
    expect(result.headers.getSetCookie()).toEqual(cookies);
    expect(result.headers.get("location")).toBe("/perfil");
    expect(result.headers.get("allow")).toBe("POST");
    expect(result.headers.get("retry-after")).toBe("30");
  });

  test("returns an unfinished stream without buffering or consuming it", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const original = new Response(stream, { status: 202, statusText: "Still streaming" });

    const result = finalizeResponse(request, original);

    expect(result.bodyUsed).toBe(false);
    expect(stream.locked).toBe(false);
    expect(result.status).toBe(202);
    expect(result.statusText).toBe("Still streaming");
    controller.enqueue(new TextEncoder().encode("first "));
    const reader = result.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first ");
    controller.enqueue(new TextEncoder().encode("second"));
    controller.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("second");
    expect((await reader.read()).done).toBe(true);
  });

  test("retains all transient OIDC cookies on authorization and callback errors", async () => {
    const env = {
      DB: {},
      AUTH_URL: "https://auth.example.invalid",
      EFFECT_LATAM_CLIENT_ID: "synthetic-client",
      EFFECT_LATAM_CLIENT_SECRET: "synthetic-secret",
    } as unknown as Env;
    const loginRequest = new Request("https://effectlatam.com/api/auth/login?returnTo=/perfil");
    const callbackRequest = new Request(
      "https://effectlatam.com/api/auth/callback?state=synthetic&error=login_required",
      { headers: { Cookie: "oidc_state=synthetic" } },
    );
    // Missing state exercises a callback rejection without a provider call.
    const invalidCallback = new Request("https://effectlatam.com/api/auth/callback");
    for (const [incoming, original] of [
      [loginRequest, await loginOidc(loginRequest, env)],
      [invalidCallback, await handleOidcCallback(invalidCallback, env)],
      // login_required clears all transient cookies before restarting the flow.
      [callbackRequest, await handleOidcCallback(callbackRequest, env)],
    ] as const) {
      const result = finalizeResponse(incoming, original);
      expect(result.status).toBe(original.status);
      expect(result.headers.getSetCookie()).toEqual(original.headers.getSetCookie());
      expect(result.headers.get("location")).toBe(original.headers.get("location"));
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      if (original.status === 302) expect(result.headers.getSetCookie()).toHaveLength(4);
    }
  });
});
