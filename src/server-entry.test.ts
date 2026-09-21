import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { api, render } = vi.hoisted(() => ({ api: vi.fn(), render: vi.fn() }));

vi.mock("./api/handler", () => ({ handleApiRoute: api }));
vi.mock("@tanstack/solid-start/server", () => ({
  createStartHandler: () => render,
  defaultStreamHandler: vi.fn(),
}));

import worker from "./server-entry";

const env = {} as Env;
const context = {} as ExecutionContext;

beforeEach(() => {
  api.mockReset();
  render.mockReset();
  render.mockImplementation(async () => new Response("rendered page"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["/", "/"],
  ["/learn?next=%2Fforos&x=1", "/learn?next=%2Fforos&x=1"],
  ["//attacker.invalid/collect?x=1", "//attacker.invalid/collect?x=1"],
  ["///attacker.invalid/collect", "///attacker.invalid/collect"],
  [String.raw`/\attacker.invalid/collect?x=1`, "//attacker.invalid/collect?x=1"],
  ["/%2f%2fattacker.invalid/collect", "/%2f%2fattacker.invalid/collect"],
  ["/%5cattacker.invalid/collect", "/%5cattacker.invalid/collect"],
])("www canonical redirect for %s", (path, expectedPath) => {
  test.each(["GET", "POST"])("keeps %s on the canonical origin", async (method) => {
    const request = new Request(`https://www.effectlatam.com${path}`, {
      method,
      ...(method === "POST" ? { body: "synthetic form payload" } : {}),
    });
    const response = await worker.fetch(request, env, context);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://effectlatam.com${expectedPath}`);
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});

test("the canonical apex still dispatches API requests without redirecting", async () => {
  const request = new Request("https://effectlatam.com/api/auth/me");
  api.mockResolvedValue(Response.json({ authenticated: false }));

  const response = await worker.fetch(request, env, context);

  expect(response.status).toBe(200);
  expect(response.headers.has("location")).toBe(false);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  await expect(response.json()).resolves.toEqual({ authenticated: false });
  expect(api).toHaveBeenCalledWith(request, env);
  expect(render).not.toHaveBeenCalled();
});

test("the canonical apex still renders non-API paths without redirecting", async () => {
  const request = new Request("https://effectlatam.com//attacker.invalid/collect?x=1");

  const response = await worker.fetch(request, env, context);

  expect(response.status).toBe(200);
  expect(response.headers.has("location")).toBe(false);
  await expect(response.text()).resolves.toBe("rendered page");
  expect(api).toHaveBeenCalledWith(request, env);
  expect(render).toHaveBeenCalledWith(request, { context: { env } });
});

test.each([429, 503])("finalizes an API admission response with status %s", async (status) => {
  api.mockResolvedValue(
    Response.json({ error: "admission_denied" }, { status, headers: { "Retry-After": "30" } }),
  );

  const response = await worker.fetch(
    new Request("https://effectlatam.com/api/auth/login"),
    env,
    context,
  );

  expect(response.status).toBe(status);
  expect(response.headers.get("retry-after")).toBe("30");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(render).not.toHaveBeenCalled();
});

test("finalizes caught API failures", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.mockRejectedValue(new Error("synthetic handler failure"));

  const response = await worker.fetch(
    new Request("https://effectlatam.com/api/notifications"),
    env,
    context,
  );

  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
});

test("finalizes the canonical redirect before API routing", async () => {
  const response = await worker.fetch(
    new Request("https://www.effectlatam.com/api/auth/callback?state=synthetic"),
    env,
    context,
  );

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(
    "https://effectlatam.com/api/auth/callback?state=synthetic",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(api).not.toHaveBeenCalled();
});

test("adds security headers to an immutable rendered redirect", async () => {
  render.mockResolvedValue(Response.redirect("https://effectlatam.com/learn", 302));

  const response = await worker.fetch(new Request("https://effectlatam.com/"), env, context);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://effectlatam.com/learn");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("cache-control")).toBe(false);
});
