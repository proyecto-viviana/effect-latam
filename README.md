# Effect Latam

The source for [effectlatam.com](https://effectlatam.com): a Spanish-first place
to learn [Effect](https://effect.website), with runnable lessons and a small
community forum.

> Effect Latam is a community project. It is not the official Effect site.
> For reference documentation, go to [effect.website/docs](https://effect.website/docs/).

## What is in it

- **Seven interactive lessons.** Each one runs real Effect code in your browser
  and shows what happened, step by step: `Effect.gen`, the error channel,
  Layers, `all` and `race`, Schedule, Schema and Scope.
- **Four short articles** on the ideas behind the lessons.
- **Forums, profiles, achievements and notifications** for people who sign in.
- A map of where the community is, by country.

The site is in Spanish and Brazilian Portuguese; the flags in the header switch
between them. Lessons keep an English title where it helps.

## Run it locally

You need Node 24 and pnpm (the exact version is pinned in `package.json`).

```bash
pnpm install
cp .dev.vars.example .dev.vars   # turns on a fake local login
pnpm dev:local                   # creates the local database, then serves http://localhost:4177
```

The `.dev.vars` file enables a synthetic user so you can try the forums without
an identity provider. It only works on `localhost`, and it must never be
enabled on a deployed site.

Before you open a pull request:

```bash
pnpm check   # format, lint, types
pnpm test    # unit tests
pnpm build
```

The browser suite needs Chromium once: `pnpm exec playwright install chromium`,
then `pnpm test:e2e`. More in [docs/TESTING.md](docs/TESTING.md).

## How it is built

| Part      | Choice                                                  |
| --------- | ------------------------------------------------------- |
| UI        | SolidJS 2 with plain CSS (no Tailwind, no React)        |
| Framework | TanStack Solid Start, server-rendered                   |
| Lessons   | `effect` 4                                              |
| Hosting   | Cloudflare Workers                                      |
| Database  | Cloudflare D1 with Drizzle                              |
| Sign-in   | OpenID Connect (authorization code with PKCE)           |
| Tooling   | vite-plus (`vp`) for dev, build, lint, format and tests |

Solid, TanStack Start and Effect are pinned to release candidates on purpose.
Expect some churn until they ship stable versions.

Where things live:

```text
src/learn/        course text, articles and the lesson engines (src/learn/labs)
src/routes/       pages
src/api/          JSON API served by the Worker
src/auth/         sign-in, sessions and the local fake login
src/security/     rate limits and response headers
src/vendor/       forum, moderation, entitlement and OIDC modules owned by this repo
drizzle/          database migrations
e2e/              Playwright tests
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how a request moves
through the app. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers running your
own copy.

## Contributing

Corrections to the lessons are the most useful contribution: if something about
Effect is wrong, unclear or out of date, open an issue or a pull request. See
[CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, follow
[SECURITY.md](SECURITY.md) instead of opening an issue.

## License

Code is [MIT](LICENSE). Course text is [CC BY 4.0](LICENSE-CONTENT.md). Fonts,
map data and flags keep their own terms, listed in
[docs/ASSETS.md](docs/ASSETS.md). The Effect name and logo, and the Effect Latam
logo, are not covered by these licenses.
