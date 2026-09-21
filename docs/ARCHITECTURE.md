# Architecture

Effect Latam is one Cloudflare Worker. It renders the pages on the server,
serves a small JSON API and stores community data in a D1 database.

## A request, end to end

`src/server-entry.ts` handles every request in this order:

1. `www.effectlatam.com` is redirected to `effectlatam.com`.
2. Paths under `/api/` go to `src/api/handler.ts`.
3. Everything else is rendered by TanStack Solid Start from `src/routes/`.
4. `src/security/response.ts` adds the security and cache headers to whatever
   comes back. Responses that depend on who is signed in are never cached.

## Lessons

The course is code, not Markdown:

- `src/learn/catalog.ts` lists the lessons and articles.
- `src/learn/course.ts` holds each lesson's goals, exercise and self-check.
- `src/learn/articles.ts` holds the four articles.
- `src/learn/labs/` holds one engine per lesson.

An engine is a plain function that builds an Effect program for the chosen
preset, runs it, and returns a trace of what happened. The page
(`src/components/LabPlayground.tsx`) only draws that trace. Engines have no UI
and no network access, so they run the same in the browser and in unit tests.

A lesson has two views: "describe" shows the steps the author expects, and
"run" shows what the engine produced. Visiting a lesson is recorded as a visit.
The site does not claim you have mastered anything.

## API

`src/api/handler.ts` routes `/api/*`. Before any write it checks that the
request comes from this site (`Origin` and Fetch Metadata), reads the body with
a size limit (`src/api/body.ts`) and applies rate limits. Forum routes live in
`src/api/forums.ts`.

| Area          | Routes                                                       |
| ------------- | ------------------------------------------------------------ |
| Sign-in       | `/api/auth/login`, `/callback`, `/me`, `/logout`, `/profile` |
| Learning      | `/api/learn/visit`, `/api/achievements`                      |
| Forums        | `/api/forums`, `/api/forum/*`                                |
| People        | `/api/users/:username`, `/api/community/countries`           |
| Notifications | `/api/notifications`, `/api/notifications/read`              |

Every write is authorized on the server. Hiding a button in the UI is never the
only check.

## Sign-in and sessions

Sign-in is OpenID Connect with the authorization code flow and PKCE
(`src/auth/oidc.ts`, `src/auth/resolve.ts`). After the callback the Worker
verifies the ID token, creates or updates the user and stores a session in D1.
The browser gets an `HttpOnly` cookie holding a random token. Administrator
roles come from the `EFFECT_LATAM_ADMIN_EMAILS` secret and are re-evaluated at
every sign-in, so removing an email also removes the role.

For local work, `EFFECT_LATAM_DEV_AUTH=1` swaps all of that for one synthetic
user. It requires a `localhost` request and is off unless you set it.

## Rate limits

`src/security/abuse.ts` counts attempts per IP address and per account in
ten-minute windows, stored in D1. Sign-in, profile edits, lesson visits,
threads, replies, reports and notification changes each have their own limit.
Rejected attempts count too. If the tables are missing, protected writes fail
closed.

## Database

The schema is in `src/db/schema.ts`, which re-exports the forum and achievement
tables from `src/vendor/social/`. Migrations are SQL files in `drizzle/` and are
applied with Wrangler.

## Vendored modules

`src/vendor/` holds the forum, moderation, entitlement and OIDC code. It is
ordinary source in this repository: edit it here. The schema file defines more
tables than the site uses today.

## Styling

Plain CSS in `src/styles/`, imported in a fixed order by `app.css`: fonts, theme
tokens, base, site chrome, then page layouts. Controls are native HTML elements
wrapped in `src/components/ui.tsx`. The mobile menu is a `details` element, so
it works without JavaScript.
