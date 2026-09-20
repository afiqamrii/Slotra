# Roadmap

**Status:** Phases 1–6 and the Phase 7 payment foundation with server-side plan gates are implemented in code; migrations through 0012 are applied to the connected Supabase project. Live gateway integration, isolated-database guest payment browser submission, authenticated operations acceptance, and independent-connection concurrency acceptance remain pending.

| Phase | Scope | Status |
| ---: | --- | --- |
| 1 | Application and design foundation | Implemented foundation |
| 2 | Authentication and tenancy | Implemented |
| 3 | Onboarding, branches, and resources | Implemented in code and main schema; manual acceptance pending |
| 4 | Booking and availability engine | Code, isolated tests, and Supabase schema applied; real PostgreSQL concurrency acceptance pending |
| 5 | Owner booking and calendar operations | Implemented in code; authenticated browser acceptance pending |
| 6 | Public booking experience | Implemented in code and schema; isolated guest browser acceptance pending |
| 7 | Customer booking payment foundation | Manual/Test, ToyyibPay sandbox, and plan payment gates implemented; live gateway and isolated browser acceptance pending |
| 8 | Starter reporting | Planned |
| 9 | Professional analytics | Planned |
| 10 | Business features | Planned |
| 11 | Pro and multi-branch features | Planned |
| 12 | SaaS billing, feature gating, and production hardening | Payment feature gates started; SaaS billing and other gating planned |

## Acceptance remaining

Phase 3: authenticated desktop/mobile onboarding and branch/resource inspection. Phase 4 migrations 0004–0005 were applied to the connected Supabase project to fix a live Courts & Spaces query failure. Next, use a dedicated development PostgreSQL database for a true two-connection overlapping-booking race and query-plan review, then inspect logs. Do not claim production concurrency acceptance solely from in-process PGlite tests.

## Phase 5 operational rollout

The owner/staff bookings list, detail, quick manual/walk-in form, day/week calendar, resource timeline, available-now status, reschedule, lifecycle actions, and timed resource blocks are implemented. Migration 0006 was applied to the connected Supabase project and isolated integration tests pass. Authenticated desktop/mobile acceptance and server/browser-log review remain open because the signed-in in-app browser could not be controlled from this task. Payment state, refunds, public checkout, and production concurrency acceptance remain outside this phase.

## Phase 6 public rollout

The static Smash Arena preview has been replaced by `/book/[organizationSlug]`, a live mobile-first slot picker, guest details/review, and private tokenized confirmation. The public adapter reuses the booking engine for live availability, pricing, stale-slot rechecks, and overlap protection. Migrations 0007–0008 were applied to the configured Supabase connection. Automated tests, lint, type-check, and production build pass. The existing configured venue route was checked read-only at 375/390/430/tablet/desktop widths; a test guest booking was not written into that live venue. A separate development PostgreSQL URL is needed for a non-invasive full browser submission and a true two-connection race test. Phase 7 will handle payment gateway choice and reconciliation; Phase 6 explicitly uses Pay at venue only.

## Phase 7 payment foundation rollout

Manual receipts and refunds, tenant-scoped policy/settings UI, normalized ledger, TestProvider, signed test webhook, expiring checkout holds, server-calculated deposits, and public/staff payment states are implemented. Migration 0012 adds a trusted Starter-default plan code. Server-side checks now lock online payment, deposit, provider connection, and online refund actions for Starter; Professional, Business, and Pro inherit those entitlements. No SaaS plan purchase or self-service upgrade exists. Migrations 0009–0011 are applied to the connected Supabase project without seeding payment records. Isolated integration tests cover holds, signed replay, late payment, cross-tenant access, and refund math. A ToyyibPay hosted-bill sandbox adapter is connected through the real sandbox API and guarded by nonproduction configuration; production online checkout is deliberately unavailable. A separate development database is needed for browser end-to-end money-flow simulation without altering the connected main project. Before production online launch: select and integrate a merchant-owned gateway, schedule and monitor hold expiry, test two independent PostgreSQL connections, verify live provider reconciliation and refund callbacks, and perform financial/security acceptance. SaaS subscriptions remain a later phase.



