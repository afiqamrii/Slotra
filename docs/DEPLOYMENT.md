# Deployment

Step 18 prepares one shared Next.js deployment backed by server-only PostgreSQL. It does not provision staging, deploy production, verify DNS, activate billing or establish backups. Record actual environment evidence in [INTEGRATION_READINESS.md](INTEGRATION_READINESS.md) before changing a status to READY.

## Environments

| Environment | Database | External effects |
| --- | --- | --- |
| Development | Disposable local PostgreSQL or dedicated development project | Explicit simulators; optional authorized provider tests. |
| Staging / Preview | Separate Supabase project; synthetic records only | Exact email-recipient allowlist; no production merchant credentials; jobs off unless deliberately enabled. |
| Production | Independently approved production project | Only configured and accepted providers/schedules. |

Use Vercel environment-specific secrets. Never copy production `DATABASE_URL` into Preview. A branch name or successful build does not establish isolation. Set `DEPLOYMENT_ENV=staging` for previews: `NODE_ENV=production` also applies to staging production builds. Protect staging with Vercel Deployment Protection. No deployment-protection setting has been verified on the connected account. See [Vercel environments](https://vercel.com/docs/deployments/environments) and [deployment protection](https://vercel.com/docs/deployment-protection).

Create a separate Supabase staging project, confirm its reference differs from production, and apply Git-tracked Drizzle migrations. Drizzle remains the sole migration authority; do not apply the same SQL through a second system. Supabase documents [separate staging and production projects](https://supabase.com/docs/guides/deployment/managing-environments).

CI uses Node 24. The existing region is `hnd1`; verify the actual database region before changing it. Serverless runtime uses the project's transaction-pooler URL. Administrative migrations may use a separate direct/session connection. Keep the private `app` schema server-only.

The default `vercel.json` intentionally contains no cron entry so the application can deploy on the current Hobby target. Scheduled work remains unconfigured and must stay disabled. A five-minute opt-in definition is stored at [examples/vercel-scheduled-jobs.json](examples/vercel-scheduled-jobs.json); follow [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) before adding its `crons` entry to the root configuration on a plan that supports it. Do not substitute a daily job: that would miss time-sensitive reminders. Runtime flags cannot prevent Vercel from validating a statically declared cron during deployment. This change does not activate a scheduler or upgrade the provider plan.

## Configuration

Store real values in the deployment secret manager; `.env.example` contains placeholders. Builds can run without live provider credentials; deployed runtime core validation must pass before database-dependent work.

| Group | Required values / action |
| --- | --- |
| Core | `DEPLOYMENT_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| Production domain | `NEXT_PUBLIC_PRODUCT_DOMAIN=slotra.my`; this derives marketing, app and booking origins |
| Development/staging origins | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BOOKING_URL`, `NEXT_PUBLIC_MARKETING_URL` when the product root is intentionally unset |
| Target guard | `EXPECTED_DATABASE_FINGERPRINT`; staging also requires `PRODUCTION_DATABASE_FINGERPRINT` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`; staging uses `STAGING_EMAIL_ALLOWLIST` |
| Jobs | `ENABLE_SCHEDULED_JOBS`, `CRON_SECRET`; an intentional staging test also needs `ALLOW_STAGING_JOBS=true` |
| Optional integrations | The grouped `.env.example` and [INTEGRATION_READINESS.md](INTEGRATION_READINESS.md) are the configuration inventory. Missing optional providers must not prevent manual bookings. |

In production, `NEXT_PUBLIC_PRODUCT_DOMAIN=slotra.my` derives `https://slotra.my`, `https://app.slotra.my` and `https://book.slotra.my`; `BETTER_AUTH_URL` must equal the derived app origin. Explicit production URL variables are optional compatibility values and, when supplied, must match those derived origins. Staging may instead use three explicit HTTPS origins with the product root unset. Auth secret is unique and at least 32 characters. Fingerprints omit passwords and canonicalize Supabase direct/pooler addresses to project reference/database. Verify actual project ownership in the provider dashboard too. Alternate non-Supabase hostnames can represent one database, so different hashes alone do not establish separation.

After loading the intended environment securely, compute its nonsecret fingerprint:

```sh
node --env-file-if-exists=.env.local --import tsx -e "import('./src/lib/runtime-config.ts').then(m => console.log(m.databaseFingerprint(process.env.DATABASE_URL)))"
```

Compare with the independently verified target before storing it. Never automatically accept a changed fingerprint after a mismatch.

## CI and migrations

`.github/workflows/ci.yml` runs install, lint, typecheck, isolated tests and a production Webpack build on PRs/main. It has read-only repository permission and no database/provider/deployment secrets. Ordinary CI does not migrate, seed or deploy. Require CI through branch protection; that dashboard setting is not verified by repository code. If main already auto-deploys via Vercel, account for that existing behavior before merging a migration release.

1. Generate and inspect Drizzle SQL/journal. Check tenant foreign keys, RLS, grants, locks, indexes and backwards compatibility. Do not use schema push for deployment.
2. Apply on disposable development PostgreSQL, test, then repeat on separate staging. Record actual migration journal/constraint checks.
3. Complete staging acceptance and confirm recovery evidence appropriate to the production release.
4. Before production migration, confirm target, SQL revision, backup and deployment compatibility. Set `MIGRATION_TARGET_FINGERPRINT` for the exact connection, `DEPLOYMENT_ENV=production` and one-run `ALLOW_PRODUCTION_MIGRATIONS=true`.
5. Run `npm run db:migrate`. Optional `MIGRATION_DATABASE_URL` selects an administrative connection; otherwise it uses `DATABASE_URL`. The guard checks before connecting. Remote targets need fingerprint acknowledgment; staging rejects its known production target.
6. Read the journal/constraints after application, then deploy compatible code. Remove the one-run migration flag from ordinary runtime environments.

No runtime or CI build migration is automatic. Destructive changes need a separately reviewed recovery/data-migration procedure. Code rollback does not roll back schema; prefer additive expand/contract and forward repairs. Review the pending filenames in Git instead of relying on historical migration counts.

## Domains and TLS

Configure marketing at `https://slotra.my`, the dashboard/auth origin at `https://app.slotra.my`, and public booking at `https://book.slotra.my/{slug}`. One deployment serves all tenants. Add all three hosts to the intended Vercel project and copy only the exact A/AAAA/CNAME targets its dashboard supplies into authoritative DNS. The root has been selected in product configuration, but registration/ownership, DNS, Vercel attachment and certificates have not been verified here.

The router compares only normalized configured hosts; it does not accept arbitrary subdomains of `slotra.my`. Pro customer hostnames resolve only through verified, active tenant-domain records and the separate deployment-ready allowlist. Marketing auth links redirect to the app origin. Better Auth creates callbacks from `BETTER_AUTH_URL`, so Vercel must allow `https://app.slotra.my` and that exact URL must be used in production. Public metadata uses the marketing origin for the product and the canonical booking origin for venue pages.

Custom hostnames require tenant TXT proof plus actual deployment-host and TLS readiness before activation. Unknown hosts fail closed. DNS proof alone never means a domain is live. See [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md). Use provider-managed HTTPS, not certificates stored in app tables. Do not promote a staging artifact containing staging `NEXT_PUBLIC_*` origins directly to production: build with the approved production configuration.

## Providers

Email uses server-only Resend configuration and a verified `EMAIL_FROM`. Publish the exact DKIM and SPF/return-path records from Resend; review DMARC and the monitored reply-to with the domain owner. Send the authorized self-test and inspect the received message/headers. Provider acceptance with an ID is not proof of inbox delivery. Staging must use controlled addresses in `STAGING_EMAIL_ALLOWLIST`, separate credentials and synthetic data. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

Starter stays manual/pay-at-venue. Professional entitlement alone does not connect a live merchant. ToyyibPay is intentionally sandbox-only; never turn its shared test category into one production merchant for all venues. Live booking payments require venue-owned merchant onboarding, checkout/deposit/balance behavior, signed event verification, reconciliation, supported refunds, expiry jobs and concurrency acceptance. SaaS billing is a separate venue-to-platform adapter and ledger; its simulator cannot operate in production. Production checkout reports configuration incomplete. See [PAYMENTS.md](PAYMENTS.md) and [SAAS_BILLING.md](SAAS_BILLING.md).

WhatsApp requires an official provider, approved templates, consent records, opt-out handling and delivery acceptance. Credentials do not establish those conditions. Storage requires separate staging configuration, deliberate public-branding/private-file policy, type/size/path checks and a real upload/readback test. A URL does not prove a bucket exists. Back up object bytes separately from database metadata.

Use the single protected job runner in [OPERATIONS.md](OPERATIONS.md). Enable only after migration, secrets and environment checks. A cron entry is not proof it ran: inspect persisted job evidence. Do not run unified and legacy schedules for the same task. Monitoring needs a configured sink, redaction review, safe synthetic error and verified alert recipient. Add uptime checks against `/api/health` and a synthetic venue; a DSN or local log is not proof of alert delivery.

## Seeds and smoke tests

Only seed synthetic data in an independently verified test database. The base fixture creates Smash Arena, sports/courts/hours/customers/bookings, but no user account. Create controlled owners through normal signup and use isolated tenants for Professional/Business/Pro scenarios. The richer Professional fixture is restricted to `professional.owner@example.test` and requires an existing verified owner on Professional.

Both seeds require `ALLOW_DEV_SEED=true`, matching `SEED_DATABASE_FINGERPRINT` and `ALLOW_REMOTE_DEV_SEED=true` for remote targets. The Professional fixture also requires `--apply`. Production environment markers and known production fingerprints are rejected before connecting. Opt-in is an operator assertion, not proof the database is disposable. Never seed the connected main project.

Set `SMOKE_BASE_URL` to the staging origin and `SMOKE_VENUE_SLUG=smash-arena`, then run `npm run smoke`. The fast script checks marketing/login, anonymous dashboard protection, health, anonymous API denial and public venue/initial availability. It makes no write requests and reports skipped venue checks. It does not claim a guest completed a booking.

Complete these staging-only manual acceptance steps:

1. Sign in as the controlled owner, confirm tenant context and dashboard.
2. Open public booking at 375/390/430px, tablet and desktop; select a real available slot.
3. Create a guest Pay-at-venue booking with a controlled inbox; verify total, paid zero and outstanding.
4. Check owner Bookings/Calendar immediately, then attempt an occupied and stale slot; expect rejection.
5. Test explicitly enabled payment/subscription simulators locally on disposable data; never interpret them as production acceptance.
6. Verify provider absence/failure, job replay and independent-connection PostgreSQL reservation/corporate/payment races.
7. Inspect safe logs/outbox/health; record revision/environment/date/results without secrets or customer details.

## Rollback

Pause affected outbound work during an incident. Restore the last compatible app deployment with its approved configuration after reviewing schema compatibility. Do not replay charges, reset financial ledgers or delete notification history. Prefer forward corrective migrations. Database restore requires a confirmed point, rehearsed procedure and provider reconciliation; see [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) and [OPERATIONS.md](OPERATIONS.md).
