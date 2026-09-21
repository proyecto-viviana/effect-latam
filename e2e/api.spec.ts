import { expect, test, type APIResponse } from "@playwright/test";

function expectPrivate(response: APIResponse) {
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(
    response
      .headers()
      ["vary"].toLowerCase()
      .split(/\s*,\s*/),
  ).toContain("cookie");
}

test("local D1 serves bounded, nonoverlapping thread and reply pages", async ({ request }) => {
  const first = await (await request.get("/api/forum/threads?forumSlug=errors")).json();
  const second = await (await request.get("/api/forum/threads?forumSlug=errors&page=2")).json();
  expect(first).toMatchObject({ total: 25, limit: 20, page: 1, hasMore: true });
  expect(second).toMatchObject({ total: 25, page: 2, hasMore: false });
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(5);
  expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);
  const detail = await (await request.get("/api/forum/threads/fixture-thread?page=2")).json();
  expect(detail.posts).toMatchObject({ total: 25, limit: 20, page: 2, hasMore: false });
  expect(detail.posts.items).toHaveLength(5);
  expect(detail.thread.author).not.toHaveProperty("email");
  expect(detail.posts.items.map((post) => post.replyOrdinal)).toEqual([21, 22, 23, 24, 25]);
  for (const page of ["-1", "1.5", "Infinity", "nope"]) {
    const result = await (
      await request.get(`/api/forum/threads?forumSlug=errors&page=${page}`)
    ).json();
    expect(result.page).toBe(1);
  }
  expect((await request.get("/api/forum/threads?forumSlug=unknown")).status()).toBe(404);
});

test("unauthenticated and cross-origin writes fail; local sign-in, profile, reports and logout work", async ({
  request,
  baseURL,
}) => {
  const write = { forumSlug: "general", title: "Valid title", content: "Valid content" };
  expect((await request.post("/api/forum/threads", { data: write })).status()).toBe(401);
  expect(
    (
      await request.post("/api/forum/threads", {
        data: write,
        headers: { Origin: "https://attacker.invalid" },
      })
    ).status(),
  ).toBe(403);
  const getLogout = await request.get("/api/auth/logout");
  expect(getLogout.status(), await getLogout.text()).toBe(405);
  expectPrivate(getLogout);
  const login = await request.get("/api/auth/login?returnTo=%2Fperfil", { maxRedirects: 0 });
  expect(login.status()).toBe(302);
  expect(login.headers()["location"]).toMatch(/\/perfil$/);
  expect(login.headers()["set-cookie"]).toContain("HttpOnly");
  expectPrivate(login);
  const me = await (await request.get("/api/auth/me")).json();
  expect(me.authenticated).toBe(true);
  expect(me.profile).not.toHaveProperty("accessToken");
  expect(
    (
      await request.post("/api/forum/threads", {
        data: "{",
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/forum/threads", { data: { ...write, content: "x".repeat(70_000) } })
    ).status(),
  ).toBe(413);
  expect(
    (
      await request.post("/api/forum/threads", { data: { ...write, title: "x".repeat(201) } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch("/api/auth/profile", {
        data: { username: "browser_learner", name: "Browser Learner", countryCode: "UY" },
        headers: { Origin: baseURL! },
      })
    ).status(),
  ).toBe(200);
  expect((await (await request.get("/api/auth/me")).json()).profile.username).toBe(
    "browser_learner",
  );
  const report = await request.post("/api/forum/reports", {
    data: { targetType: "thread", targetId: "fixture-thread", reason: "Synthetic local report" },
  });
  expect(report.status()).toBe(201);
  const reportBody = await report.json();
  const repeatedReport = await request.post("/api/forum/reports", {
    data: { targetType: "thread", targetId: "fixture-thread", reason: "Synthetic local report" },
  });
  expect(repeatedReport.status()).toBe(201);
  expect(await repeatedReport.json()).toEqual(reportBody);
  const notifications = await request.get("/api/notifications");
  expect(notifications.status()).toBe(200);
  expectPrivate(notifications);
  expect((await notifications.json()).notifications).toBeInstanceOf(Array);
  const achievements = await request.get("/api/achievements");
  expect(achievements.status()).toBe(200);
  expectPrivate(achievements);
  expect((await request.post("/api/notifications/read", { data: { ids: [] } })).status()).toBe(200);
  expect(
    (
      await request.post("/api/notifications/read", { data: { ids: Array(101).fill("invalid") } })
    ).status(),
  ).toBe(400);
  const logout = await request.post("/api/auth/logout", { maxRedirects: 0 });
  expect(logout.status()).toBe(302);
  expectPrivate(logout);
  expect((await (await request.get("/api/auth/me")).json()).authenticated).toBe(false);
  const signedOut = await request.get("/api/notifications");
  expect(signedOut.status()).toBe(401);
  expectPrivate(signedOut);
});
