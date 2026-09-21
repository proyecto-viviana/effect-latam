# Contributing

Thanks for helping. Issues and pull requests are welcome in Spanish, Portuguese or
English.

## Good first contributions

- Fix something in a lesson or article that is wrong or confusing. The text is
  in `src/learn/course.ts` and `src/learn/articles.ts`; the code each lesson
  runs is in `src/learn/labs/`.
- Improve accessibility, wording or mobile layout.
- Improve a translation. Every text has an `es` and a `pt` version side by side,
  and `src/i18n/parity.test.ts` fails when one is missing.
- Add a test for a bug you found.

For anything larger, such as a new lesson or a new feature, open an issue first
so we can agree on the shape before you spend time on it.

## Setup

Follow "Run it locally" in the [README](README.md). Then, before you push:

```bash
pnpm check
pnpm test
pnpm build
```

Run `pnpm test:e2e` too if you changed pages, the API or the database.
`pnpm fmt` fixes formatting for you.

## Guidelines

- **Lessons must be honest.** A lesson shows what Effect really did. Do not
  hard-code an output that the engine did not produce, and check API names
  against the pinned `effect` version, not against older tutorials.
- **Keep the stack small.** No React, no Tailwind, no UI kit. Import reactivity
  from `solid-js` and DOM or JSX APIs from `@solidjs/web`.
- **Be careful near sign-in, permissions, migrations and user content.** Say in
  the pull request what you changed and how you tested it.
- **Never commit secrets.** `.dev.vars` and `.env.local` are ignored for that
  reason.
- Keep pull requests focused: one change, with tests where they make sense.

Only maintainers deploy. A merged pull request does not go live on its own.

## Licensing

By contributing you agree that your code is released under the
[MIT license](LICENSE) and your course text under [CC BY 4.0](LICENSE-CONTENT.md).
If you add a third-party asset, record its source and license in
[docs/ASSETS.md](docs/ASSETS.md).
