import { expect, test, type Page } from "@playwright/test";
import { LABS, ARTICLES } from "../src/learn/catalog";

async function hydrated(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
}

test("shared header, keyboard navigation and responsive reading layouts", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const fonts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(request.url());
  });
  for (const path of [
    "/",
    "/learn",
    "/learn/effect-gen-playground",
    "/learn/articles/why-effect-gen",
    "/foros",
    "/foros/effect-gen/fixture-thread",
  ]) {
    await hydrated(page, path);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCSS("font-family", /Inter Variable/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const home = page.getByTestId("brand-home");
    await expect(home).toHaveAccessibleName("Effect Latam");
    const logos = [
      home.locator("img"),
      page.locator("footer").getByRole("img", { name: "Effect Latam" }),
    ];
    for (const logo of logos) {
      await expect(logo).toHaveAttribute("src", "/logo-header.svg");
      await expect
        .poll(() =>
          logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
    }
    for (const width of testInfo.project.name === "mobile" ? [320, 390, 768] : [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const logo of logos) {
        const box = await logo.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width / box!.height, `original logo ratio at ${width}px`).toBeCloseTo(
          1930 / 580,
          2,
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        `${path} at ${width}px`,
      ).toBeLessThanOrEqual(1);
    }
  }
  await hydrated(page, "/learn");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Ir al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByLabel("Alternar navegación");
  await menu.click();
  await expect(page.getByTestId("nav-learn-mobile")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(page.getByTestId("nav-forums-mobile")).not.toBeVisible();
  await menu.click();
  await page.getByTestId("nav-forums-mobile").click();
  await expect(page).toHaveURL(/\/foros$/);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((font) => new URL(font).origin === new URL(page.url()).origin)).toBe(true);
  expect(errors).toEqual([]);
});

test("all seven labs describe without running, execute and reset every preset", async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const lab of LABS) {
    await hydrated(page, `/learn/${lab.slug}`);
    const output = page.getByTestId("lab-output");
    const picker = page.getByLabel("Caso de estudio");
    const presets = await picker
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    for (const preset of presets) {
      await picker.selectOption(preset);
      await page.getByTestId("lab-describe").click();
      await expect(output).toContainText('"executed": false');
      await page.getByTestId("lab-run").click();
      await expect(output).toContainText('"executed": true');
      expect(JSON.parse(await output.innerText())).toHaveProperty("ok");
    }
    if (presets.length > 1) {
      await picker.selectOption(presets[0]!);
      await expect(output).toContainText("El resultado va a aparecer acá.");
    }
    await expect(page.getByRole("heading", { name: "Tu turno", exact: true })).toBeVisible();
  }
});

test("readings are rendered as articles in the server response", async ({ page, request }) => {
  for (const article of ARTICLES) {
    const path = `/learn/articles/${article.slug}`;
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("<article");
    await hydrated(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(article.title.es);
    await expect(page.locator(".article-prose h2")).toHaveCount(3);
    await expect(page.locator("article")).not.toContainText("src/content");
  }
  expect((await request.get("/learn/no-such-lesson")).status()).toBe(404);
  expect((await request.get("/learn/articles/no-such-reading")).status()).toBe(404);
  expect((await request.get("/foros/no-such-forum")).status()).toBe(404);
});

test("forum failures can be retried without showing a false empty state", async ({ page }) => {
  await page.route(
    "**/api/forum/threads?*",
    (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }),
    { times: 1 },
  );
  await hydrated(page, "/foros/errors");
  await expect(page.getByRole("heading", { name: "No pudimos cargar los temas" })).toBeVisible();
  await expect(page.getByText("Todavía no hay conversaciones en este espacio.")).not.toBeVisible();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.locator(".discussion-list li")).toHaveCount(20);
  await page.getByRole("button", { name: "Siguiente →" }).click();
  await expect(page.locator(".discussion-list li")).toHaveCount(5);
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Anterior" }).click();
  await expect(page.locator(".discussion-list li")).toHaveCount(20);
  await hydrated(page, "/foros/effect-gen/fixture-thread");
  const replies = page.getByRole("region", { name: "Respuestas", exact: true });
  await expect(replies.locator("article")).toHaveCount(20);
  await page.getByRole("button", { name: "Siguiente →" }).click();
  await expect(replies.locator("article")).toHaveCount(5);
  await expect(replies).toContainText("Respuesta de prueba 25");
});

test("sign-in returns to the composer; failed writes preserve drafts and successful posts persist", async ({
  page,
}, testInfo) => {
  await hydrated(page, "/foros/general");
  await page.getByRole("link", { name: "Entrar para participar" }).click();
  await expect(page).toHaveURL(/\/foros\/general#nuevo-hilo$/);
  const title = `Una pregunta ${testInfo.project.name}`;
  const body = "<script>window.injected = true</script> ¿Cómo modelar un fallo?";
  await page.getByTestId("thread-title").fill(title);
  await page.getByTestId("thread-body").fill(body);
  await page.route(
    "**/api/forum/threads",
    (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }),
    { times: 1 },
  );
  await page.getByTestId("thread-submit").click();
  await expect(page.getByRole("alert")).toContainText("Tu texto sigue acá");
  await expect(page.getByTestId("thread-title")).toHaveValue(title);
  await expect(page.getByTestId("thread-body")).toHaveValue(body);
  await page.getByTestId("thread-submit").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator(".post__body").first()).toHaveText(body);
  expect(await page.evaluate(() => "injected" in window)).toBe(false);
  await page.getByTestId("reply-body").fill("Una respuesta que debe persistir.");
  await page.route(
    "**/api/forum/threads/*/posts",
    (route) => route.fulfill({ status: 429, json: { error: "rate_limited" } }),
    { times: 1 },
  );
  await page.getByTestId("reply-submit").click();
  await expect(page.getByRole("alert")).toContainText("Esperá un momento");
  await expect(page.getByTestId("reply-body")).toHaveValue("Una respuesta que debe persistir.");
  await page.getByTestId("reply-submit").click();
  await expect(page.getByTestId("reply-body")).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("region", { name: "Respuestas", exact: true })).toContainText(
    "Una respuesta que debe persistir.",
  );
});

test("capture the course, lesson and community at the project viewport", async ({
  page,
}, testInfo) => {
  for (const [name, path] of [
    ["course", "/learn"],
    ["lesson", "/learn/effect-gen-playground"],
    ["forums", "/foros"],
    ["thread", "/foros/effect-gen/fixture-thread"],
  ]) {
    await hydrated(page, path!);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
});

test("Portuguese readers start in Portuguese; the flag toggle switches and persists", async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({ baseURL, locale: "pt-BR" });
  const page = await context.newPage();
  await hydrated(page, "/learn");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByTestId("nav-forums").or(page.getByTestId("nav-forums-mobile"))).toHaveText(
    ["Fóruns", "Fóruns"],
  );

  if (testInfo.project.name === "mobile") await page.getByLabel("Alternar navegação").click();
  await page.getByTestId("locale-es").locator("visible=true").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByTestId("locale-es").locator("visible=true")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await hydrated(page, "/foros");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Fóruns");
  await context.close();
});

test("the install command follows the chosen package manager", async ({ page }) => {
  await hydrated(page, "/");
  const command = page.getByTestId("install").locator("code");
  await expect(command).toHaveText("pnpm add effect@rc");
  await page.getByTestId("install-manager").selectOption("npm");
  await expect(command).toHaveText("npm install effect@rc");
  await expect(page.getByTestId("install-copy")).toHaveAccessibleName(
    "Copiar npm install effect@rc",
  );

  await hydrated(page, "/");
  await expect(command).toHaveText("npm install effect@rc");
});
