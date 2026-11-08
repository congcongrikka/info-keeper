# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.7.x   | Yes       |
| < 1.7   | No        |

v1.7.0 is the first public release. Only the latest 1.7.x line receives
security fixes.

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting:
*Repository → Security → Report a vulnerability*.

No contact e-mail is published for this repository. If private vulnerability
reporting is unavailable on your fork, reach the maintainers through their
GitHub profile instead. Please do not post vulnerability details in a public
issue under any circumstances.

Please include the affected version, reproduction steps, impact, and any
suggested fix. Reports in Chinese or English are both welcome.

You can expect an initial response within 7 days. Once a report is confirmed,
a fix and a security advisory will be published; please allow a reasonable
coordinated disclosure window before making the issue public.

## Key rotation guidance

This project never requires secrets in the repository. The following values
are read from **server-side environment variables only** and must be set in
your deployment platform — never in `.env.example` or any committed file:

- `AI_API_KEY`
- `INVITE_CODE`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PRIVATE_KEY` (regenerate `NEXT_PUBLIC_VAPID_PUBLIC_KEY` as a pair)
- `CRON_SECRET`
- `SMTP_PASS`

If any of these is ever committed or otherwise exposed:

1. Rotate it immediately at the provider (Supabase, model provider, mail
   provider, deployment platform).
2. Redeploy so the new value takes effect.
3. Regenerating a VAPID key pair invalidates every existing push
   subscription — users must re-enable the daily digest on each device.
4. Changing `INVITE_CODE` should be accompanied by a review of accounts
   created with the previous code.
5. Removing a secret from the current tree is **not enough** if it was ever
   pushed: rewrite history (or start a new clean history) and rotate anyway.

## Out of scope

- Vulnerabilities in third-party services (Supabase, model providers, SMTP
  providers, Vercel) — report those to the respective vendor.
- Issues that require a valid invitation code on an instance you do not own.
- Automated scanner output without a working proof of concept.
