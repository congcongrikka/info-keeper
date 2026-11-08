# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-11-08

First public release. This release adds open-source governance files and
documentation only; no business logic or API behavior was changed.

### Added

- AI-assisted structured capture: one write triggers type detection, title,
  summary, tags, key points, next actions, priority and due date, stored as
  columns rather than free text.
- RAG question answering: `pg_trgm` Chinese trigram retrieval, three-way recall
  merge, character-budget trimming, streaming answers and `[1][2]` citations
  linking back to the source entries.
- Automatic entry linking (`related` / `duplicate` / `follow_up` /
  `contradicts`) with bidirectional visibility on the detail page.
- Multi-tenant isolation: database RLS (`auth.uid() = user_id`) plus an
  application-layer `userId` requirement on every query.
- Invitation-code registration: server-side `sha256` + `timingSafeEqual`,
  per-IP rate limiting, and fail-closed behavior when `INVITE_CODE` is unset.
- PWA with a hand-written service worker, an offline fallback page and iOS home
  screen adaptations.
- Daily digest over two channels: Vercel Cron -> Web Push (per-device, 410/404
  subscription pruning) and SMTP email fallback for Android devices without
  Google services; `CRON_SECRET` fail-closed protection.
- JSON export of all personal data; public health-check endpoint.
- Open-source governance: `LICENSE` (MIT), `NOTICE`, `SECURITY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, CI workflow,
  `CHANGELOG.md` and `docs/OPEN_SOURCE_CHECKLIST.md`.

### Security

- Secrets are read only in server-side Route Handlers / `src/lib` and never
  carry the `NEXT_PUBLIC_` prefix.
- Registration and cron endpoints fail closed when their secrets are missing.
- `service_role` is confined to `src/lib/supabase/admin.ts`; cross-user
  aggregation functions are granted only to `service_role`.
- zod request validation, model-output normalization, and security response
  headers configured in `next.config.ts`.
- The service worker caches only static assets and `/offline`; navigation
  requests are network-only to avoid cross-account page leaks.
- `.env.example` contains placeholders only. No real keys, invitation codes or
  account data are committed.

### Changed

- Theme artwork is now optional and excluded from the repository. When it is
  absent the UI falls back to a neutral placeholder (see
  `public/miku/README.md` and `NOTICE`).
- Documentation no longer contains private deployment URLs, local machine
  paths, real account data or internal hand-off notes.
- `package.json` bumped to 1.7.0 with `license`, `repository`, `homepage` and
  `bugs` metadata; the dev server now uses the framework default port 3000.

### Breaking Changes

None. No business logic, database schema or public API was modified.

[1.7.0]: https://github.com/congcongrikka/info-keeper/releases/tag/v1.7.0
