# Slotra

A multi-tenant sports venue booking SaaS built with Next.js, Better Auth and PostgreSQL. Venue setup, guest and staff bookings, calendars, manual payments, reporting, plan limits and advanced operations use persisted data. Production launch is conditional on external services and acceptance gates.

Start with [the product specification](docs/PRODUCT_SPEC.md), [roadmap](docs/ROADMAP.md), and [current project audit](docs/PROJECT_AUDIT_2026-10-16.md). Implemented development phases are not fully accepted production capabilities.

The [staging and live handoff](docs/STAGING_AND_LIVE_HANDOFF_2026-10-16.md) lists the exact owner decisions, private configuration locations and acceptance sequence. Local follow-up verified partial/full refunds, rescheduling, public branch selection and space pagination.

## Run locally

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` and configure an isolated development database. Inspect the target and follow `docs/DEPLOYMENT.md` before running `npm run db:migrate`. Never target production with seed commands.

Visit `/` for the landing page and `/register` to create an account. Local verification/reset links are in `/dev/mail`. Complete venue onboarding to activate `/book/{venue-slug}`. `/dashboard` requires a verified account and organization membership.

## Checks

```bash
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run build
```

`npm start` serves a production build and requires validated runtime configuration. Vitest covers isolated PGlite migrations, domain behaviour and authorization. Both the default Turbopack build and `npm run build -- --webpack` passed the current audit. A build does not establish deployed PostgreSQL concurrency or provider acceptance.

`npm run smoke` runs read-only HTTP checks. Set `SMOKE_BASE_URL` and `SMOKE_VENUE_SLUG` for staging. Authenticated mutations and responsive/keyboard acceptance need additional checks.

For the optional disposable browser fixture:

```powershell
node scripts/e2e-server.mjs
```

The harness refuses project environment files, creates fresh data for all four plans, writes disposable credentials under ignored `.billing-verification/`, and serves `http://127.0.0.1:3018`. Its generated configuration uses a direct local PGlite driver, physical source snapshot and separate build output with no remote database/provider credentials. Restart it after code changes. Never share its credential file. Stop it after testing. PGlite tests do not replace independent PostgreSQL race acceptance.

## Production prerequisites

Follow [deployment](docs/DEPLOYMENT.md), [integration readiness](docs/INTEGRATION_READINESS.md), and [release checks](docs/RELEASE_CHECKLIST.md). Configure and accept a verified Resend sender for transactional/auth/invitation mail. Live venue payments, recurring SaaS billing, WhatsApp, webhook HTTP delivery, and customer-domain activation retain implementation or operational gates. Public branch selection and space pagination are implemented and require staging acceptance. Legal pages are review placeholders. A plan entitlement or simulator does not establish a live integration.

## Temporary branding

Set `NEXT_PUBLIC_PRODUCT_NAME` to change the display name and `NEXT_PUBLIC_BRAND_ACCENT` to a six-digit hex colour to change the shared accent. Review contrast when changing the accent.
