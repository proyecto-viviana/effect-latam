# Security

## Reporting a problem

Please do not open a public issue for a vulnerability. Use
[GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability").

Tell us which page or API route is affected, how to reproduce it and what an
attacker could do. Remove tokens, cookies, email addresses and other personal
data from anything you attach.

We will confirm we received the report, assess it and coordinate a fix and
disclosure with you. There is no bounty, and we cannot promise a response time.

Only the current `main` branch, as deployed at <https://effectlatam.com>, is
supported.

## Rules for anyone running this code

- `EFFECT_LATAM_DEV_AUTH` creates a fake signed-in user. Use it only on
  `localhost`. Never enable it on a deployed Worker.
- Keep the OIDC client secret and the administrator email list in Worker
  secrets. Never commit them, `.dev.vars`, `.env.local`, session cookies or
  database exports.
