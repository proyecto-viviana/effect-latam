# Notes for coding agents

Read [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md) first; the
same rules apply to you.

- Stack: SolidJS 2, TanStack Solid Start, Effect 4, Cloudflare Workers and D1,
  vite-plus (`vp`). Do not add React or Tailwind.
- Check Effect APIs against `node_modules/effect/ai-docs` and
  `node_modules/effect/src` for the pinned version. Many v3 names changed.
- Lessons must show real engine output, never a hard-coded result.
- Run `pnpm check`, `pnpm test` and `pnpm build` before you finish.
- Never enable `EFFECT_LATAM_DEV_AUTH` outside local development, never commit
  secrets, and never deploy. Production is <https://effectlatam.com> and only
  maintainers release to it.
