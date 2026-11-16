# Step 18 integration readiness

This is a release evidence register, not a sales feature list. **READY** requires configuration and a successful check in the intended deployed environment. **NEEDS CONFIGURATION** means code/preparation exists but credentials, infrastructure or acceptance evidence are missing. **BLOCKED** means a required implementation/authorization decision remains. A local unit test or an environment variable alone cannot establish a live integration.

No production deployment, main-database migration, DNS change, provider charge, email delivery, WhatsApp delivery or restore drill is claimed by this document. Historical migration/test results in other docs remain historical; collect new evidence for the release revision.

## Integration register

| Integration | Status | Implemented/prepared | Remaining evidence or decision |
| --- | --- | --- | --- |
| EMAIL / RESEND | NEEDS CONFIGURATION | Shared escaped responsive templates, server-only adapter, truthful delivery states, staging recipient restriction, authorized self-test and booking-independent delivery. | Resend sending key, verified sender, monitored reply-to, exact DNS records, received test and template acceptance. |
| AUTH EMAIL / INVITATIONS | NEEDS CONFIGURATION | Guarded verification/reset/invitation delivery through Resend, local-only inbox, trusted links, effective team authorization and rate-limited resend. | Verified sender/DNS and received signup/reset/invitation expiry/replay acceptance on isolated staging; see NOTIFICATIONS.md. |
| BOOKING PAYMENTS | BLOCKED for live online collection | Starter manual ledger, provider abstraction, deposits/holds/idempotency/refund foundation; intentionally sandbox-only ToyyibPay. | Select/accept live venue-owned merchant adapter, provider account/onboarding, callbacks, reconciliation, supported refunds and real PostgreSQL races. Manual pilot can proceed separately after other gates. |
| SAAS BILLING | BLOCKED for live collection | Separate subscription domain, exact monthly/annual catalog, trial/grace/changes and local simulator. | Select a Slotra-owned live subscription provider, implement/accept recurring collection and reconciliation; no current production credential can turn simulator into a live adapter. |
| WHATSAPP | BLOCKED for live delivery | Local-only simulator and consent-aware interface boundary. | Official provider adapter, verified venue sender, approved templates, persisted purpose-specific opt-in/opt-out, receipt verification and real acceptance. No production delivery is enabled. |
| STORAGE | NEEDS CONFIGURATION | Private branding bucket adapter, bounded image decode/re-encode, tenant paths and published-asset serving. | Separate Supabase storage project/bucket credentials, inspect actual privacy policy, upload/readback/IDOR tests and object backup. |
| BACKGROUND JOBS | NEEDS CONFIGURATION | One protected Cron runner with database leases, bounded tasks, execution evidence and backoff. | Apply pending job migration on approved staging; configure secret/schedule/runtime plan; verify runs, lease recovery and overdue alerts. |
| CUSTOM DOMAINS | NEEDS CONFIGURATION | Tenant ownership proof, constrained hosts and verification-aware routing preparation. | Real customer TXT proof, deployment host registration, HTTPS readiness and accepted activation. Verified DNS alone is not active service. |
| MONITORING | NEEDS CONFIGURATION | Structured redacted logs and one minimal Sentry event adapter. | Sentry project/DSN, permitted endpoint, synthetic ingestion and alert recipient acceptance; inspect browser/server coverage. |
| OUTBOUND WEBHOOKS | BLOCKED for live delivery | Scoped endpoint configuration, signed/deduplicated queue, fenced claims/lease recovery and bounded injected-transport worker tested without HTTP delivery. | Approved HTTPS egress/SSRF/DNS-pinning transport, protected runtime/scheduler wiring and independent real-receiver acceptance. Queued tests are not sent. |
| BACKUPS | NEEDS CONFIGURATION | Recovery inventory and staging restore drill documented. | Actual provider coverage/retention, recent recovery point, off-site/object strategy and successful drill. |
| STAGING | NEEDS CONFIGURATION | Environment/target guards, guarded seeds, CI and read-only smoke script. | Separate database and deployment with scoped credentials/protection; full guest/operator/provider-negative acceptance. |
| PRODUCTION DOMAIN | NEEDS CONFIGURATION | `slotra.my` selected; one validated root derives the marketing/app/booking origins, canonical metadata and closed host policy. | Confirm registration/ownership, attach all three hosts to Vercel, install authoritative DNS and verify certificates/redirects. |
| LEGAL | NEEDS CONFIGURATION | Clearly marked draft route/link readiness. | Approved Terms/Privacy/Acceptable Use, support contact and venue-provided policy text; no compliance conclusion is made. |

## Exact configuration inventory

Values below are names only. Add secrets to the correct environment's secret manager, never this file. The grouped `.env.example` is the source for supported runtime names.

| Area | Values still to confirm/provide |
| --- | --- |
| Deployed core | `DEPLOYMENT_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `EXPECTED_DATABASE_FINGERPRINT` |
| Staging database | Independent staging `DATABASE_URL` and `EXPECTED_DATABASE_FINGERPRINT`; `PRODUCTION_DATABASE_FINGERPRINT` as denylist |
| Production domains | `NEXT_PUBLIC_PRODUCT_DOMAIN=slotra.my`, `BETTER_AUTH_URL=https://app.slotra.my`; explicit production URL overrides, if retained, must match derived origins |
| Staging domains | Explicit `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BOOKING_URL`, `NEXT_PUBLIC_MARKETING_URL` with an intentionally unset product root |
| Custom-domain serving | `CUSTOM_DOMAINS_ENABLED`, `CUSTOM_DOMAIN_READY_HOSTS` only after operator verification of deployment registration/TLS and the tenant DNS proof/active state |
| Branding/support | `NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_BRAND_ACCENT`, `SUPPORT_EMAIL` where configured centrally |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`; `STAGING_EMAIL_ALLOWLIST` for exact controlled staging addresses |
| Storage | `SUPABASE_STORAGE_URL`, `SUPABASE_STORAGE_SECRET_KEY`, `SUPABASE_BRANDING_BUCKET`; staging `STAGING_STORAGE_PROJECT_REF` |
| Scheduler | `ENABLE_SCHEDULED_JOBS`, `CRON_SECRET`; deliberate staging only `ALLOW_STAGING_JOBS` |
| Monitoring | `SENTRY_DSN` for the one supported sink; alert recipients are configured in its dashboard |
| Pro webhook signatures | `SLOTRA_WEBHOOK_SIGNING_KEY`; setting it enables signing/configuration, not an outbound worker |
| Administrative migrations | Optional `MIGRATION_DATABASE_URL`, `MIGRATION_TARGET_FINGERPRINT`; one-run `ALLOW_PRODUCTION_MIGRATIONS` only after production authorization |
| Synthetic fixture tooling | `ALLOW_DEV_SEED`, `ALLOW_REMOTE_DEV_SEED`, `SEED_DATABASE_FINGERPRINT`; never production |
| Read-only smoke | `SMOKE_BASE_URL`, optional `SMOKE_VENUE_SLUG` (required for venue check) |

Development-only payment/billing variables already exist: `ENABLE_TEST_PAYMENTS`, `TEST_PAYMENT_WEBHOOK_SECRET`, `ENABLE_TOYYIBPAY_SANDBOX`, `TOYYIBPAY_SANDBOX_SECRET_KEY`, `TOYYIBPAY_SANDBOX_CATEGORY_CODE`, `TOYYIBPAY_SANDBOX_ORGANIZATION_ID` or `TOYYIBPAY_SANDBOX_SCOPE`, `ENABLE_DEV_SUBSCRIPTIONS`, `DEV_SUBSCRIPTION_WEBHOOK_SECRET`, and `WHATSAPP_DEV_MODE`. They must remain disabled in hosted production/preview. They are not missing production credentials. No live payment/SaaS/WhatsApp variable names are invented before choosing and implementing those adapters.

Legacy individual runner secrets (`PAYMENT_HOLD_SWEEP_SECRET`, `REPORT_RUNNER_SECRET`, `BUSINESS_AUTOMATION_RUNNER_SECRET`, `SAAS_BILLING_RUNNER_SECRET`) are superseded: legacy URLs delegate to the unified dispatcher and require `CRON_SECRET`. Disable old schedules rather than scheduling duplicate work.

## Exact DNS and dashboard actions still needed

1. Confirm ownership/registration of `slotra.my`, then add `slotra.my`, `app.slotra.my` and `book.slotra.my` to the intended Vercel project. Copy that project's exact A/AAAA/CNAME values into authoritative DNS. No target IP/CNAME is inferred here, and a DNS no-record response is not proof that the name is purchasable.
2. Add the selected sender domain/subdomain in Resend. Publish every exact DKIM/SPF/return-path record from that account, wait for verified status, and review DMARC policy/alignment with the domain owner. Set the sender/reply-to, send the authorized test and inspect actual received headers.
3. For each customer custom domain, publish TXT `_slotra-verify.<hostname>` with the one-time `slotra-verification=<token>` generated by that tenant action. Do not reuse a made-up token. Verify ownership server-side, register deployment hostname and prove HTTPS before activation.
4. Configure Vercel Preview secrets separately, deployment protection, supported cron cadence/runtime and safe trusted proxy headers. Confirm main's existing auto-deploy behavior and required CI checks before merging.
5. Provision/confirm separate Supabase staging project, private branding bucket, storage credentials and backup coverage. Keep the private application schema out of browser Data API grants.
6. Create/confirm the selected Sentry project and alert destination. Send a safe synthetic event and verify actual ingestion/notification.

The exact provider-generated DNS values cannot be supplied until the real domains/accounts are chosen. No DNS record is marked installed.

## Provider accounts and decisions

- Resend account with sending permission for the chosen domain and separate restricted staging key.
- Separate Supabase staging project; production and staging backup/storage configuration verified independently.
- Vercel project/environment configuration supporting the selected schedule and domain topology.
- One Sentry project with an accountable operator and alert route.
- A production booking gateway must support each venue's own merchant account. ToyyibPay remains a supported sandbox experiment, not a chosen live acquirer.
- A separate Slotra-owned SaaS subscription merchant/provider must be selected for recurring billing.
- Official WhatsApp sender/provider onboarding plus consent/template implementation remains a future activation decision.

No new account, paid service or provider merchant has been created by this task.

## Migration and test evidence

Previous documented main-database state ends at migration 0023. Pending `0024_deep_demogoblin.sql` adds private platform job state and notification PROCESSING; `0025_handy_blade.sql` adds nullable venue policy fields. Inspect both SQL files/journal and apply only to an independently approved target. Neither is automatically applied to the connected main project. An unrun migration is a release blocker for code depending on it.

Current local audit evidence: `npm run lint` and `npm run typecheck` passed; 35 automated files / 389 tests passed; `npm audit --omit=dev` reported zero vulnerabilities; and the final Next 16.3.8 default Turbopack production build passed. An earlier Webpack build also passed. The truncated native compiler was restored from an official exact-version archive whose integrity matched the lockfile. See [the dated audit](PROJECT_AUDIT_2026-10-16.md) for the full evidence and remaining development-only advisory.

The disposable PGlite browser fixture applied all migrations through 0025 without a remote connection. Final sequential `npm run smoke` passed all six checks with zero failed or skipped checks; 64 semantic HTTP route checks also passed at the earlier checkpoint. A guest booking appeared in the owner dashboard, Calendar and Booking Detail, and its manual receipt updated the balance. Follow-up browser testing verified partial/full refunds, occupied-slot rejection, paid-balance preservation during a time-only move and reviewed duration repricing. Public branch choice, fourteen-space paging/search and a RM45 second-branch guest confirmation also passed. Selected owner/public views at 375/390/430/768/1280px, including a 375×568 confirmation, had no horizontal page overflow. This evidence is development-only and does not establish staging/provider readiness.

Provider-blocked checks: real Resend receipt/SPF/DKIM, live venue checkout/deposit/refund/reconciliation, recurring SaaS billing, actual WhatsApp delivery/opt-out, storage upload/readback, cron invocation/alerts, custom-host DNS/TLS, monitoring ingestion, and restore drill. Local mocked/provider-negative tests do not replace them.

Critical staging acceptance: signup/reset, guest Pay-at-venue submission, owner calendar visibility, occupied/stale-slot rejection, tenant/branch IDOR, production simulator denial, independent-connection PostgreSQL races, provider absence/failure resilience, and desktop/mobile booking. The read-only `npm run smoke` deliberately does not create records; complete the write-capable checklist in DEPLOYMENT.md.

## Launch gates and next stage

Before any external pilot: establish isolated staging, apply/review pending migrations, complete auth-email access, verify sender and support contacts, complete restore/backup acceptance, configure/observe jobs and monitoring, approve legal/policy text and run critical staging flows. Fix failures before accepting real customer activity.

A manual/pay-at-venue pilot may defer live online gateway, live recurring SaaS purchase, WhatsApp, outbound webhooks and custom domains if those capabilities stay unavailable and are described honestly. Storage uploads may remain unavailable while safe placeholder/URL branding is used. Never sell an unavailable capability as connected.

Recommended next stage: **Staging preparation**. Remain in Development until a deliberately configured separate staging environment and its migration target are available. Private Pilot follows the minimum launch gates above; unrestricted Production is not accepted by this report.
