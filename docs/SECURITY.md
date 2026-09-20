# Security

**Status:** Authentication/tenancy, staff booking, and the Phase 6 public guest boundary are implemented. Real-provider online-payment and production abuse-hardening reviews remain pending.

## Tenant isolation and authorization

Every tenant-owned operation must be scoped to an authorized organization. Never trust organization or branch IDs supplied by a client without server-side authorization. Validate that branch and resource references belong to the authorized organization. Public booking may be accessed by guests, but its tenant context must be resolved and constrained by the server. Current roles and permission grants are centralized in `src/lib/permissions.ts`; every privileged server action rechecks active membership and permission.

## Invitation links

Invitation tokens are stored only as hashes. A user with the current organization’s invite permission can renew a pending link; renewal replaces the hash and invalidates the previous URL. The link is shown only to that authorized user for private sharing, and the invited email must match the verified account that accepts it. Local development currently exposes link copying; production invitation delivery remains pending.

## Input, secrets, and integrations

Validate external input at server boundaries, including forms, route parameters, API requests, webhooks, and imported data. Keep secrets in managed environment configuration; never commit credentials or expose server secrets to browser code. Verify webhook authenticity, replay handling, and idempotency before accepting provider events. The development TestProvider uses HMAC verification. ToyyibPay sandbox callbacks use the provider-documented MD5 hash plus an independent server-side bill-transaction check; browser return parameters are not proof of payment. A live provider credential and rotation strategy remain undecided.

## Payment-data boundaries

Prefer provider-hosted handling of sensitive payment credentials. Do not store raw card details or other sensitive payment credentials in application tables or logs. The Manual/Test foundation and ledger reconciliation are documented in `PAYMENTS.md`; real merchant provider selection, external reconciliation, and compliance responsibilities remain undecided.

## Security review requirements

Before shipping authentication, tenancy, public booking, payments, integrations, or permission changes, review tenant isolation, authorization paths, input validation, secret exposure, logging, abuse controls, and tests for cross-tenant access. Document the chosen controls and any residual risks. Incident response, retention, and backup policies remain **undecided**.

## Current database boundary

The initial tables are in the private PostgreSQL `app` schema. The migration revokes PUBLIC access and enables RLS without browser policies. The PostgreSQL URL is validated at the server boundary and must never be exposed through `NEXT_PUBLIC_` variables. Privileged server access can bypass RLS; future queries therefore still require explicit membership authorization and organization scoping. Revisit the database grants and policies before exposing any table via the Supabase Data API.



## Phase 4 booking boundary

OWNER/ADMIN/MANAGER and STAFF receive booking view/create/update/cancel/check-in permissions; VIEWER may view only. Each domain entry point verifies active membership and the relevant permission. Every branch, resource, customer, booking, block, and price query is organization-scoped; composite foreign keys provide a second tenant-integrity layer. The Phase 6 guest entry point is separately scoped by a server-resolved active organization slug. Booking references are generated with cryptographic randomness; financial snapshots come only from server-side base pricing. SQL exclusion enforcement prevents active resource overlap even if two checks race. The new tables remain in private `app`, with RLS enabled and no Data API grants. Independent-connection race testing on a real development PostgreSQL server remains required before production acceptance.


## Phase 6 public booking boundary

Guests never receive server database credentials or direct access to the private `app` schema. An invalid slug, incomplete or inactive organization, inactive branch, or unassigned sport does not resolve to a bookable venue. Availability and submission validate the slug and re-derive organization/branch; a submitted resource ID is accepted only if active and owned by that venue/branch. The common booking transaction rechecks conflicts, duration, hours, advance limits, and server base pricing. Input is Zod-validated, including names, international-friendly phone characters, email, date horizon, resource UUID, and a hidden honeypot field. Errors are mapped to customer-safe messages; no database exception text is returned.

Guest customer association happens only after full details are submitted, with an exact phone and case-insensitive email and name match inside the resolved organization. There is no pre-submit customer-existence endpoint and no cross-tenant lookup. The confirmation link uses a 32-byte random bearer token; only SHA-256 is stored, and lookup still scopes by organization slug. The confirmation route sends noindex, no-store, and no-referrer response headers. Treat the link as private; anyone possessing it can view the limited customer-facing confirmation. Reference-only lookup is deferred until reference plus verified contact proof can be reviewed.

The existing `rate_limits` table provides atomic per-window counters. Initial page and availability requests are capped per visitor across slugs at 180 per five minutes, submissions at eight per visitor across slugs per ten minutes, and a normalized-contact hash at four per hour. IP is obtained from forwarded headers and hashed before storage; contact is also hashed. A bot can spoof forwarding headers unless a trusted reverse proxy strips client-supplied values, so production deployment must enforce trusted proxy headers and add WAF/CAPTCHA or stronger distributed abuse controls if traffic warrants. Counter rows need a retention cleanup job; no such job is added in this phase. Browser action Origin checks are provided by Next.js, but deployment configuration must preserve them. Never log confirmation tokens or send them to analytics.




## Phase 7 payment boundary

The private payment tables have RLS enabled and PUBLIC table grants revoked. Provider account rows hold nonsecret merchant identifiers only; webhook secrets are server environment values. A real integration must use provider-managed or encrypted credentials and a venue merchant account, never make Slotra the custodian of booking funds. Only the development TestProvider and ToyyibPay sandbox are callable now, each with explicit nonproduction flags. The ToyyibPay key is server-only and may be shared across test venues only; production requires per-venue merchant accounts. The raw-body booking webhook verifies a constant-time signature before an atomic unique-event claim and tenant-scoped payment mutation. It returns safe errors, never raw provider payloads. A secret-protected sweep endpoint expires checkout holds; an external scheduler is required before live online payment. The public simulator is rate-limited and development-only. Organization `plan_code` defaults to Starter. Payment settings, provider connections, new online holds, and online refunds enforce centralized feature entitlements in services, not just the UI. Historical verified payment events still reconcile after a downgrade, while new online checkout is masked.

The owner-only **sandbox plan test** is the sole exception to operator-controlled plan assignment. Its separate callback verifies ToyyibPay's documented hash in constant time, matches the stored bill code and organization, and independently checks the exact external attempt ID, RM129 amount, and provider-success status. The return URL alone grants nothing. A locked organization row and attempt state make repeats idempotent; another tenant cannot read or initiate an attempt. The new private table has RLS and revoked PUBLIC grants. Production code disables the route and action via sandbox configuration, and no live subscription or charge exists. A production SaaS plan purchase needs a separate Slotra merchant account, authenticated subscription lifecycle, renewals, invoice/reconciliation logic, and security review.

## Starter reporting and email boundary

Basic reports, customer search, and CSV exports require authenticated organization-scoped role access; CSV also requires centralized `CSV_EXPORT` entitlement. Customer contact data is never available through booking-view-only roles. Export rows are capped and values beginning with spreadsheet formula characters are prefixed before quoting. The server uses private-schema privileged credentials, while the new usage and notification tables retain RLS without browser policies or PUBLIC grants.

Email recipients and booking details are read through organization-scoped joins. Resend credentials and sender identity are server environment values, never database rows or browser props. Notification records avoid storing full provider payloads. A missing provider is not marked sent. Booking success is independent of email delivery, and an outbox retry process is still required for production reliability. The production signup/reset email path remains blocked rather than sending sensitive account links through an unapproved new destination. Do not claim the Starter plan is production-sellable until that delivery path and staff invitations are approved and configured.

`payment:view`, `payment:record_manual`, `payment:refund`, and `payment:manage_settings` are checked in services, not only hidden UI controls. Refund/payment operations use organization-scoped IDs and composite foreign keys; tested IDORs fail. Manual refund records mean staff assert funds were returned outside Slotra. ToyyibPay sandbox bank simulation is not real collection. No real gateway webhook, live refund API, or production credential connection is claimed. Before a live provider launches, review webhook secret rotation, trusted proxy/rate limits, merchant onboarding, dispute/chargeback policy, reconciliation, financial data retention, scheduler health, and independent-connection concurrency.
