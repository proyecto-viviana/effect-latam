# Vendored modules

Forum, achievements, moderation, entitlements and OIDC relying-party code that
this app owns as plain source. It was copied in from a shared codebase, trimmed
to the files the app imports, and is edited here directly. There is no upstream
to sync with.

| Folder          | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| `social/`       | Threads, posts, reports, notifications, achievements, schema |
| `moderation/`   | Moderation cases, policy and detector contracts              |
| `entitlements/` | Pure permission and quota decisions                          |
| `oidc-rp/`      | Bounded OIDC HTTP, JWKS resolution and ID token verification |
