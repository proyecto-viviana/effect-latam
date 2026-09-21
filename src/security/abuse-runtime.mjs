// Local workerd/D1 regression, using the Miniflare version pinned by Wrangler.
// No application server, user database, secret file or remote binding is used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = await import(
  wranglerRequire.resolve("miniflare")
);
const source = stripTypeScriptTypes(readFileSync(new URL("./abuse.ts", import.meta.url), "utf8"));
const worker = `
  import { consumeAbuseLimit } from "./abuse.js";
  export default {
    async fetch(request, env) {
      const now = Number(new URL(request.url).searchParams.get("now"));
      return Response.json(await consumeAbuseLimit(env.DB, request, "profile", "ip", "203.0.113.1", now));
    }
  };
`;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "abuse-test",
    modules: [
      { type: "ESModule", path: "worker.js", contents: worker },
      { type: "ESModule", path: "abuse.js", contents: source },
    ],
    compatibilityDate: "2026-08-31",
    d1Databases: ["DB"],
    log: new Log(LogLevel.NONE),
  }),
);
try {
  const db = await mf.getD1Database("DB");
  const migration = readFileSync(
    new URL("../../drizzle/0001_abuse_controls.sql", import.meta.url),
    "utf8",
  ).replace(/^--.*$/gm, "");
  const triggerIndex = migration.indexOf("CREATE TRIGGER");
  for (const query of migration
    .slice(0, triggerIndex)
    .split(";")
    .filter((part) => part.includes("CREATE TABLE"))) {
    await db.prepare(query).run();
  }
  await db.prepare(migration.slice(triggerIndex)).run();

  const admissions = await Promise.all(
    Array.from({ length: 200 }, async () => {
      const response = await mf.dispatchFetch("http://localhost/admit?now=1250");
      assert.equal(response.status, 200);
      return response.json();
    }),
  );
  assert.equal(admissions.filter((value) => value.allowed).length, 60);
  assert.equal(
    admissions.filter((value) => !value.allowed && value.retryAfter === 550).length,
    140,
  );
  const reset = await (await mf.dispatchFetch("http://localhost/admit?now=1800")).json();
  assert.equal(reset.allowed, true);
  const counters = await db.prepare("SELECT window_start, hits FROM abuse_counters").all();
  assert.deepEqual(counters.results, [{ window_start: 1800, hits: 1 }]);
  console.log(
    "PASS: local workerd + D1, 200 concurrent attempts = 60 admitted / 140 denied; reset and cleanup verified.",
  );
} finally {
  await mf.dispose();
}
