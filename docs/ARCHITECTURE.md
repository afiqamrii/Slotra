# Architecture

**Status:** Phases 1–6, the Phase 7 payment foundation, Starter operations, and Professional reporting are implemented in code. Live gateway readiness, authenticated browser acceptance, and independent-connection PostgreSQL concurrency acceptance remain pending.

## Professional reporting boundary

`plan-entitlements.ts` maps Professional and higher tiers to `ADVANCED_ANALYTICS`, `ADVANCED_REPORTS`, and `SCHEDULED_REPORTS`. Report pages, CSV route, and schedule actions enforce an authenticated organization membership/role plus server-side feature checks. `professional-reporting.ts` owns validated period/filter resolution, batched tenant-scoped queries, timezone-aware grouping, and operating-window utilization; React only renders results. Starter retains its simpler operational reports. The Professional dashboard uses the same report service, not duplicated metric logic. A report query is capped to a 93-day period and 10,000 booking rows; there is no shared cross-tenant cache. See `REPORTING.md` for definitions.

Scheduled reports use tenant-owned `report_schedules` and per-recipient `report_deliveries`. The runner is disabled without a 32+ character secret, and delivery remains an explicit preview/failure until Resend sender configuration exists. No SaaS subscription billing or Business features are introduced.

The separate `plan-upgrade-service.ts` provides only a nonproduction Starter → Professional test. It creates an owner-scoped `plan_upgrade_attempts` row, uses the same ToyyibPay **sandbox** category via a distinct plan bill/callback, and requires signed callback plus independent provider transaction verification (or equivalent server-side verification after return) before changing the plan. The organization row is locked and repeat events are idempotent. A browser return alone is not trusted. The test does not create a recurring subscription, real invoice, renewal, or booking-payment ledger entry. A real Slotra SaaS merchant account and billing lifecycle are future architecture.

## Starter operations completion

Starter's server-owned `organizations.plan_code` resolves through `plan-entitlements.ts` to feature flags and limits. `booking-usage.ts` persists one first-confirmation record in the same booking/payment transaction; an organization row lock serializes quota decisions across resources. The temporary UTC-month period resolver can later be replaced with subscription period boundaries. Resource creation/reactivation and member invitations enforce their caps in transactions; role/UI hiding is not the enforcement layer.

Dashboard, Customers, Reports, Plan & Usage, and CSV exports read tenant-scoped operational tables. Reports use branch-local booking start dates and server aggregates; the client chart only changes presentation (bar, trend, data) and metric choice (bookings, booking value, new customers). It does not calculate business totals client-side. CSV handlers require both organization permission and feature entitlement, limit rows, and neutralize spreadsheet formulas. No Professional analytics or billing workflow is implied.

Booking confirmation/reschedule/cancellation inserts a notification outbox record transactionally. Post-commit delivery uses a server-only email adapter and never rolls back booking success. The configured provider path is Resend; without it, the record remains a truthful dev preview or production failure. Production auth and team invitation delivery are still development-only and require separate approval and hardening before Starter is sellable to new venues. See `PLANS.md`.

## Principles

- Treat the system as a production SaaS with explicit tenant boundaries and server-side authorization.
- Keep domain rules separate from presentation components and transport concerns.
- Prefer small, clear modules and existing project patterns over premature abstractions.
- Keep the brand configurable and the domain model sport-neutral.
- Add dependencies when an implemented need justifies them.

## Current and intended stack

The repository has Next.js App Router, React, TypeScript, Tailwind CSS, ESLint, and `lucide-react` installed for the visual foundation. Supabase PostgreSQL, Drizzle ORM, the pg driver, and Zod environment validation now form the server-only database foundation. Better Auth and Vitest are integrated for authentication and tests. React Hook Form, TanStack Table, Recharts, date-fns, and Playwright remain future choices. Their exact roles and versions will be decided in the relevant implementation phase.

## Current presentation structure

The App Router keeps the landing, authentication, and live public booking route separate from the `(workspace)` route group. The workspace group shares a sidebar and top bar; a real organization context and placeholder route copy for later phases. `src/components` contains small reusable UI pieces, while `src/lib/brand.ts` centralizes temporary display branding. The workspace layout enforces session and active organization membership on each request; public pages remain accessible without a session.

## Intended domain boundaries

- **Tenancy and access:** platform, organizations, branches, users, roles, and authorization.
- **Venue setup:** sports, resources, operating hours, blocks, and maintenance.
- **Booking:** availability, lifecycle, conflict prevention, and recurring operations.
- **Commercial rules:** pricing, promotions, memberships, packages, and plan entitlements.
- **Payments:** payment state, provider integration, and reconciliation.
- **Customers and growth:** customer records, communication, and automation.
- **Reporting:** operational and financial views.

These are conceptual boundaries, not a prescribed folder structure, service split, or database schema. Booking, pricing, and payment rules belong outside React UI components.

## Decisions pending

Deployment and hosting topology; Supabase service usage; data-access pattern; module and folder structure; background jobs and scheduled work; event and webhook delivery; file storage; observability; API strategy; and time-zone conventions. Record each decision when implemented, including its security and migration impact.

## Database foundation

The first Drizzle migration creates a private `app` PostgreSQL schema. `src/db/schema.ts` defines the nine foundation tables; `src/db/client.ts` is a server-only connection entry point. Migration SQL is versioned under `drizzle/`. The Better Auth adapter and organization services now use the server-only connection; the connection is initialized on request. See `DATABASE.md` for constraints, migration and seed workflows, and still-pending access decisions.

The server reuses one bounded PostgreSQL pool per running application process, including across development route recompilation. Development processes use up to five connections. Production serverless instances use one connection with a shorter idle timeout and allowExitOnIdle, and must use Supabase's transaction pooler (port 6543) so horizontally scaled functions do not exhaust session-mode clients. Vercel functions are pinned to Tokyo (hnd1) in `vercel.json`, matching the Supabase ap-northeast-1 region to avoid cross-Pacific database round trips. Request-scoped React memoization deduplicates repeated session, membership, and plan reads shared by workspace layouts and pages; durable tenant data is still queried and authorized on each request. A successful migration-readiness probe is cached for the lifetime of a database client; missing-schema results and query errors are retried so a development migration can become visible without restarting.



## Phase 3 venue setup

Authenticated members with organization update permission (OWNER/ADMIN) can complete the ten-section onboarding wizard. The workspace dashboard shows a setup entry point until `onboarding_completed_at` is set. A single server transaction validates and creates the organization profile, selected sports, first branch, generic resources, branch operating hours, and branch/sport base rates, then marks completion. A browser-local draft retains progress before submission; it is not a server-side partial setup. Completing twice is rejected.

`src/lib/venue-service.ts` owns validation and tenant-scoped mutations. Server actions recheck membership; a branch ID or resource ID never establishes access. MANAGER may manage the first branch and resources under the existing permission model. The `Courts & Spaces` and first-branch settings pages are live; wider multi-branch UI remains out of scope. Sport terms live in `src/lib/space-terminology.ts`, with a generic Space fallback.

The base-rate table is a minimal configuration foundation keyed by organization, branch, and sport, with an amount in minor currency units per 60 minutes. It does not calculate booking prices or availability and does not imply a rule engine. Branding stores a display name and accent color. Logo upload remains a clearly labeled placeholder because storage and access policy are not configured. The chosen slug now resolves the public booking page after onboarding and active-state checks.


## Phase 4 booking domain (code only)

`src/lib/booking-time.ts` converts local operating schedules to UTC windows using Temporal. `booking-availability.ts` batch-loads tenant-scoped resources, hours, blocks, and active bookings and exposes availability and slot generation independently of React. `booking-service.ts` owns authenticated staff creation, base-rate snapshots, resource blocks, rescheduling, cancellation, and legal lifecycle transitions. Phase 4 itself added no owner or public booking UI; Phase 5 adds the owner/staff workspace. The database exclusion constraint is the final active-overlap guard; services also serialize on the resource row. Migrations 0004–0005 are applied to the connected Supabase project; independent-connection concurrency acceptance remains pending.

## Phase 5 staff booking operations

The `(workspace)/bookings`, `calendar`, and `available-now` routes are server-rendered and tenant-scoped. `src/lib/booking-management.ts` provides bounded joined list/detail/search/calendar queries and live status derived from the booking availability snapshot. List history is paginated 50 at a time; calendar reads are capped at 500 bookings and blocks per branch/view, and customer counts are aggregated in SQL. The UI never calculates availability, conflicts, or prices. Server actions delegate creation, reschedule, status changes, and blocks to `booking-service.ts`; each service checks membership/permission and tenant ownership again.

The quick manual/walk-in form obtains server-generated slots, supports existing-customer lookup and inline minimal customer creation, and saves the customer and confirmed booking in one transaction. Guest walk-ins are permitted without a customer record. Available Now uses current bookings, blocks, opening windows, and resource status; its Walk-In link preselects a space. The day calendar aligns bookings and blocks on a branch-local resource timeline; available links come from the slot engine. Week view is a compact seven-day overview. Click-based rescheduling uses the same domain operation with a server price preview and transaction-time revalidation. Temporary maintenance is a timed resource block, not a permanent resource-state change. No drag-and-drop is implemented; public guest booking is a separate Phase 6 entry point.

## Phase 6 public customer booking

`/book/[organizationSlug]` resolves the organization server-side in the same deployment; a future `book.productdomain.my/{slug}` host rewrite can target this route without one deployment per venue. Invalid slugs, incomplete or inactive organizations, and venues without an active branch/sport return not-found. The first active branch is used until multi-branch public selection is designed. The route renders public venue metadata, restrained branding, server-generated opening/slot information, and a guest-only flow; it does not import workspace authorization.

`src/lib/public-booking.ts` is the narrow public adapter. It resolves the tenant from the slug, validates dates and resource ownership, batch-loads the existing availability snapshot, calls `evaluateAvailability` for every cell, and obtains the existing base quote. `src/app/actions/public-booking.ts` rate-limits availability and submissions and returns only safe messages. `createGuestBooking` calls the same booking transaction as staff creation: row lock, availability recheck, base-price calculation, active-overlap exclusion backstop, customer association, CONFIRMED status, and history. A client quote is only a stale-price check, never the saved total. The later Phase 7 foundation adds optional test-only payment holds; the default public path remains Pay at venue.

The confirmation route is `/book/[organizationSlug]/confirmation/[token]`. The URL token is 32 random bytes, stored only as SHA-256 in `bookings.public_access_token_hash`. Confirmation queries also scope by resolved organization and joins only customer-facing fields. Reference-only lookup is deferred; a booking reference alone never reveals customer details. Public data is read through the private `app` schema using server-only credentials, not browser Supabase access.


## Phase 7 booking payment foundation

The booking engine remains provider-agnostic. `payment-policy.ts` calculates server-side amount due from the engine quote; `payment-providers.ts` holds ManualProvider and a development-only TestProvider contract; `toyyibpay-sandbox.ts` and `toyyibpay-service.ts` add hosted sandbox bills, callback verification, and provider reconciliation; `payment-service.ts` owns settings, account connection, ledger recomputation, manual receipts, refunds, hold expiry, and idempotent verified events. Guests choose from tenant-enabled payment options at review. A manual choice snapshots NO_UPFRONT and confirms with the full balance outstanding; a sandbox choice follows the existing verified-payment hold path. The server rechecks the selected method against current organization settings and the connected test adapter. Guest booking uses the same short resource-locked transaction and stores immutable policy/due snapshots. Required online test checkout enters AWAITING_PAYMENT, protected by the overlap constraint until expiry; only the verified event confirms it. Pay-at-venue remains CONFIRMED. ToyyibPay sandbox bill creation runs after the booking transaction, outside resource locks. Its callback signature and independent transaction query gate the common idempotent payment transition; the browser return status cannot confirm a booking.

Settings → Payments is owner/admin controlled. Booking detail shows payment history, paid/outstanding, authorized manual receipt/refund actions; Payments lists tenant-scoped recent activity. Public confirmation distinguishes pay-at-venue, deposit, full payment, pending hold, failure/expiry, and development simulation. The webhook route is a Node.js Route Handler, not a browser action. The sweep endpoint is secret-protected for future scheduling. See `PAYMENTS.md` for the full state and deployment prerequisites. Migrations 0009–0011 were applied to the connected Supabase project; the sandbox adapter needs no further schema change and no payment demo data was seeded there. The shared test key is server-only, disabled in production, and never a live multi-venue merchant strategy. `src/lib/plan-entitlements.ts` centrally maps Starter/Professional/Business/Pro to online-payment, deposit, and online-refund features; `organization-entitlements.ts` resolves the trusted `organizations.plan_code` and enforces payment capabilities server-side. Existing venues default to Starter after migration 0012. Starter's effective checkout policy is manual/pay-at-venue even if older online settings remain stored; provider events for earlier holds still reconcile. Settings renders a manual-only Starter state and a Professional preview. SaaS subscription billing and self-service plan changes are not implemented.
