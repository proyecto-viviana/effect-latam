# Deployment

Production is <https://effectlatam.com>, and only maintainers release to it.
This page is for them, and for anyone who wants to run their own copy.

## Running your own copy

1. Create a D1 database and put its name and id in `wrangler.jsonc`, along with
   your own routes and `APP_URL`.
2. Point `AUTH_URL` at an OpenID Connect provider and set
   `EFFECT_LATAM_CLIENT_ID`. The app expects `${AUTH_URL}/authorize`,
   `${AUTH_URL}/token` and `${AUTH_URL}/.well-known/jwks.json`, and it requests
   the `openid profile email` scopes. Register `${APP_URL}/api/auth/callback`
   as the redirect URI.
3. Set the two secrets:

   ```bash
   pnpm exec wrangler secret put EFFECT_LATAM_CLIENT_SECRET
   pnpm exec wrangler secret put EFFECT_LATAM_ADMIN_EMAILS   # comma-separated
   ```

4. Use your own name and logo. See [ASSETS.md](ASSETS.md).

## Releasing

Check first:

- [ ] `pnpm check`, `pnpm test`, `pnpm test:security:runtime`, `pnpm test:e2e`
      and `pnpm audit --prod` pass on the commit you are releasing, and CI is
      green for it.
- [ ] `EFFECT_LATAM_DEV_AUTH` is `"0"` in `wrangler.jsonc`.
- [ ] Both secrets exist on the Worker.
- [ ] You have compared the migrations already applied to the target database
      with the files in `drizzle/`.

Then:

```bash
pnpm run db:migrate:remote   # applies only migrations that are still pending
pnpm run deploy:dry-run      # builds and shows what would be uploaded
pnpm run deploy              # builds and deploys dist/server/wrangler.json
```

Always deploy through `pnpm run deploy`. It deploys the configuration that the
build generates; running `wrangler deploy` against the source `wrangler.jsonc`
skips the built assets.

## Smoke test

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://effectlatam.com/
curl -sS -o /dev/null -w "%{http_code}\n" https://effectlatam.com/learn
curl -sS -o /dev/null -w "%{http_code}\n" https://effectlatam.com/foros
curl -sS https://effectlatam.com/api/community/countries
# www must redirect to the apex, and login must redirect to the identity provider
curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.effectlatam.com/learn
curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://effectlatam.com/api/auth/login
```

To roll back, redeploy the previous commit. Migrations are not reversed
automatically, so write them to be compatible with the previous release.
