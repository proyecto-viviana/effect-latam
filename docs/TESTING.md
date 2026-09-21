# Testing

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once
pnpm check
pnpm test
pnpm test:security:runtime
pnpm test:e2e
```

If you use `vp` directly, run package scripts with `vp run <script>`. A bare
`vp test` is a different built-in command.

| Command                 | What it proves                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `check`                 | Formatting, lint with no warnings allowed, and types                                        |
| `test`                  | Lesson engines, sign-in and session rules, API rejections, pagination and rate-limit policy |
| `test:security:runtime` | Rate limits hold in a real local Worker and D1 under 200 concurrent attempts                |
| `test:e2e`              | A production build, driven by Playwright against a local Worker and D1                      |

The browser suite covers keyboard navigation, the header from 320 to 1440 px,
every preset of all seven lessons, the four articles, missing pages, forum
pagination, retry states, kept drafts and saved threads and replies. The API
tests cover author privacy, sessions, profiles, reports, notifications, logout
and rejected writes. The mobile project is Chromium with a phone-sized
viewport; it says nothing about Safari.

## Isolation

`scripts/e2e-server.mjs` builds a throwaway environment for each run: a
temporary directory, every migration in `drizzle/` applied to a local D1, the
fixtures from `e2e/fixtures.sql`, and a synthetic login. It never reads your
`.dev.vars`, never calls a real identity provider and never touches a remote
database. Everything is deleted when the run ends.

The server listens on port 4188. Set `EFFECT_LATAM_E2E_PORT` to change it.
Tests run with one worker so the shared fixture stays predictable. Do not run
two suites at once against the same output directory.

## Narrowing a failure

```bash
pnpm test:e2e:run                                     # reuse the existing build
pnpm exec playwright test api
pnpm exec playwright test experience --project=mobile
pnpm exec playwright show-report
```

`playwright-report/` holds the HTML report and `test-results/` holds
screenshots and traces. Both are ignored by git. CI keeps them for seven days.

## What is not covered

- The real OpenID Connect callback. The fake login is a fixture, not a test of
  the provider flow.
- Visual regression and automated accessibility audits.
- Safari and Firefox.
