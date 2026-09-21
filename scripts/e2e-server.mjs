import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fresh, local-only Worker and D1 for every run. Never reads the owner's .dev.vars.
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "effect-latam-e2e-"));
const port = Number(process.env.EFFECT_LATAM_E2E_PORT ?? 4188);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid E2E port");
const baseURL = `http://localhost:${port}`;
const configPath = join(directory, "wrangler.json");
const persistence = join(directory, "state");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const environment = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
};
// Do not pass any inherited provider credential to a local test process.
for (const key of Object.keys(environment)) {
  if (/^(CLOUDFLARE_|CF_|EFFECT_LATAM_|APP_URL|AUTH_URL)/.test(key)) delete environment[key];
}
environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
environment.WRANGLER_LOG_PATH = join(directory, "logs");
let worker;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  worker?.kill("SIGTERM");
  if (worker && worker.exitCode === null) await new Promise((done) => worker.once("exit", done));
  await rm(directory, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});

async function command(args) {
  const child = spawn(process.execPath, [wrangler, ...args], {
    cwd: directory,
    env: environment,
    stdio: "inherit",
  });
  await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(new Error(`Local Wrangler failed: ${code}`)),
    );
  });
}

try {
  const build = JSON.parse(await readFile(resolve(root, "dist/server/wrangler.json"), "utf8"));
  await writeFile(
    configPath,
    JSON.stringify({
      name: "effect-latam-e2e",
      main: resolve(root, "dist/server", build.main),
      // Dev bundling includes Wrangler's request-body drain middleware. With
      // no_bundle, early 401/403/413 responses can crash its local proxy.
      // This does not change the production build/deploy configuration.
      no_bundle: false,
      rules: build.rules,
      compatibility_date: build.compatibility_date,
      compatibility_flags: build.compatibility_flags,
      assets: { directory: resolve(root, "dist/client") },
      workers_dev: false,
      preview_urls: false,
      vars: {
        APP_URL: baseURL,
        AUTH_URL: "https://auth.invalid",
        EFFECT_LATAM_CLIENT_ID: "local-test",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "effect-latam-e2e",
          database_id: "00000000-0000-0000-0000-000000000001",
          migrations_dir: resolve(root, "drizzle"),
        },
      ],
    }),
  );
  await writeFile(
    join(directory, ".dev.vars"),
    `EFFECT_LATAM_DEV_AUTH=1\nAPP_URL=${baseURL}\nEFFECT_LATAM_CLIENT_SECRET=synthetic-local-test-only\nEFFECT_LATAM_ADMIN_EMAILS=\n`,
    { mode: 0o600 },
  );
  await command([
    "d1",
    "migrations",
    "apply",
    "effect-latam-e2e",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persistence,
  ]);
  await command([
    "d1",
    "execute",
    "effect-latam-e2e",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persistence,
    "--file",
    resolve(root, "e2e/fixtures.sql"),
  ]);
  worker = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--local",
      "--config",
      configPath,
      "--ip",
      "localhost",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      persistence,
    ],
    { cwd: directory, env: environment, stdio: "inherit" },
  );
  worker.once("error", (error) => {
    console.error(error);
    void stop(1);
  });
  worker.once("exit", (code) => {
    if (!stopping) void stop(code ?? 1);
  });
} catch (error) {
  console.error(error);
  await stop(1);
}
