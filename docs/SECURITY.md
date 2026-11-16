# Security

## 16 October 2026 audit corrections

See `PROJECT_AUDIT_2026-10-16.md` for evidence and unresolved gates. Effective custom grants and branch scope are required at UI and service boundaries. Organization-wide Customers and CSV exports use unbranched authorization; monetary exports also require `report:export` and `report:view_financial`. Payment activity filters the authorized booking branch. Basic aggregate reports deny branch-restricted roles.

Invitations cannot grant absent permissions or expand selected-branch access into an unrestricted membership. Creation, renewal and acceptance revalidate the current grantor; authorized renewal replaces the grantor and token. Hosted account links use the guarded configured email boundary; raw-link tools are local-only. See `NOTIFICATIONS.md`. Fixed rate windows recover without extending lockout on denied retries.

## Step 18 infrastructure controls and acceptance gaps

This section supersedes historical statements that scheduler/storage/host code is absent; external provisioning remains unverified. Runtime requires explicit deployed environment, HTTPS origins, strong auth secret and an approved database target. Preview is always staging, with a production database denylist and exact recipient email allowlist. Fingerprints are checks against operator-approved targets, not replacements for independently checking project ownership.

Hosted environments reject development payment/subscription/WhatsApp simulators regardless of flags. Optional provider absence is truthful and does not prevent unrelated manual operations. Production authentication link delivery remains blocked pending its separate authorization/activation and acceptance; a booking-email sender is not proof signup/reset works.

Settings → Integrations rechecks active OWNER/ADMIN membership, `integration:manage` and all-branch scope. Returned health data contains no secrets, provider payloads or another tenant's accounts. Platform-owned configuration is not presented as venue-controlled. Email self-test is restricted to the actor's stored address and three attempts/hour; staging adds exact-recipient allowlisting.

Storage is server-only with a private bucket and randomized tenant-owned path. File type, extension, size, decoded format/pixel count and still-image constraints are checked. Re-encoding strips original metadata/content. SVG is rejected. The public asset proxy only serves the active venue's currently assigned published branding file, never arbitrary private object paths. Real bucket privacy and IDOR acceptance remain staging gates.

Host routing uses only configured origins or verified+active tenant domain records plus an operator hostname/TLS allowlist. It never resolves tenancy from `X-Forwarded-Host`. Unknown hosts fail closed. The deployment must also strip spoofed forwarded IP headers before rate limiting. Custom TXT proof alone cannot activate a hostname. Arbitrary HTML/CSS/JS remains disallowed; venue policies are plain escaped text.

Global response headers add nosniff, frame denial, restrictive permissions and referrer policy. CSP blocks objects/framing and limits connections to self; current Next.js inline scripts/styles still require `unsafe-inline`, with `unsafe-eval` only in development. This is a baseline, not a nonce-based strict CSP. Private confirmations retain no-store/no-referrer/noindex. Verify effective headers after public-host rewrites and provider navigation in staging before release.

Cron uses a constant-time checked `CRON_SECRET`, explicit enablement, core target validation, database leases/fencing and bounded work. Legacy endpoints delegate to this same authorization. No network call holds a session/advisory database lock. Only expired ephemeral verification/counter rows are bounded-deleted; financial/customer/audit history remains. Failed/ambiguous delivery is reconciled rather than automatically resent.

Structured logs and the minimal Sentry adapter allowlist event code/context and exclude raw exceptions, bodies, contacts, keys and tokens. The health endpoint returns only availability state. Incoming booking-payment and subscription callbacks remain separate; outbound webhook delivery remains disabled until reviewed egress/DNS-rebinding protections and worker acceptance exist. See [OPERATIONS.md](OPERATIONS.md) for rotation, rate limits, retention and incidents; [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) for unverified recovery requirements.

## Resend email controls

Resend credentials and sender configuration remain server-only. `EMAIL_FROM` must parse to a valid sender address, `EMAIL_REPLY_TO` to a valid plain mailbox, and the API key must have the expected Resend shape before delivery is enabled. Templates HTML-escape dynamic content, restrict accent colors to six-digit hex, and accept only HTTPS venue logos. Messages exclude internal record IDs, secrets, and private admin links.

Provider errors are normalized. Logs may include only a failure code, HTTP status, and provider request ID; they exclude the API key, recipient, subject/body, and raw provider response. The owner/admin test action reauthorizes membership server-side and targets only the actor's account email. Provider absence or failure never rolls back a booking and is never stored as `SENT`. DNS and sender-release requirements are documented in [NOTIFICATIONS.md](NOTIFICATIONS.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Step 16 platform and billing controls

The SaaS billing provider/checkout/event/audit/outbox tables are separate from venue merchant accounts and booking payment/refund records. Server-owned catalog amounts, owner-only writes, tenant-scoped lookup, raw-body HMAC verification before parsing, bounded payloads, constant-time signature checks, unique provider event IDs and monotonic subscription revisions prevent browser success, forgery/replay and stale-event privilege changes. No raw payload or secret is logged/stored in audit JSON.

Effective expiry is checked per request even if the runner is late. Organization locks protect quota/cap decisions; grace failure events cannot indefinitely extend access. Suspension/soft closure preserves data, denies operational mutation and allows basic reads/export/billing. Administrative suspension remains sticky across renewal. Expiring support overrides cannot reactivate suspended operations.

Platform /admin uses a dedicated SUPER_ADMIN user field, never organization OWNER/ADMIN. All platform actions reauthorize; sensitive mutations require exact slug confirmation and reason and record an audit actor. Overrides are centrally allowlisted, bounded and expiring. No automatic platform-admin signup or provisioning exists. Production blocks the test checkout/webhook/simulator even if flags are accidentally enabled. Scheduled platform work uses only the unified dispatcher with `ENABLE_SCHEDULED_JOBS=true` and a 32+ character `CRON_SECRET`. See SUPER_ADMIN.md for operator-only provisioning and SAAS_BILLING.md for remaining live-provider/reconciliation prerequisites. Historical plan-assignment descriptions below are superseded by this section.


**Status:** Step 16 subscription/platform controls are implemented and tested; migrations through 0023 are applied. Core isolated authenticated billing/admin browser acceptance passed, including owner denial at /admin. Real-provider, independent-connection PostgreSQL and final production abuse/security-hardening reviews remain pending.

## Step 15 Pro security boundary

Branches are children of an organization. The HttpOnly branch-context cookie is a preference, never authority: the selected branch must belong to the current organization and selected-scope staff must have an explicit `member_branches` assignment. Older organization-wide service paths fail closed for branch-limited staff. Custom roles store effective allowlists; a custom ADMIN is **not** granted its base-role permissions by fallback. Only OWNER/authorized ADMIN with all-branch scope may manage roles, and a creator cannot grant a permission they do not hold. Financial dashboards and reports check `report:view_financial` server-side. OWNER cannot be reassigned through custom-role actions. See [PERMISSIONS.md](PERMISSIONS.md).

API keys are dedicated random 32-byte credentials, hashed at rest, bound to one organization and optional branch, shown only at creation, and checked for required scope, revocation, and rate limit on every request. The API does not accept browser cookies for external authorization. Reads paginate and bound date windows; writes use domain services and tenant/branch checks. `api_keys.last_used_at` is operational metadata, not permission. See [API.md](API.md).

Domain ownership requires a DNS TXT token proof; a typed hostname or successful proof does not set `is_active` or route traffic. The same hostname cannot be claimed by another organization. Application host registration/certificate issuance and trusted host routing are not implemented, so no custom domain is publicly served yet. White-label fields accept bounded plain text, a validated hex accent and HTTPS image URLs only—no arbitrary HTML, CSS, or JavaScript. See [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md).

Outbound webhook definitions accept HTTPS URLs and derive endpoint signing secrets server-side. Queued payloads contain minimal event identifiers, not contact/payment secrets. Delivery state and bounded retries are modeled, but external HTTP delivery was not approved/enabled; “queued” is never shown as “sent.” A production worker must add DNS/IP/redirect/egress protections to prevent SSRF, sign the exact body, and reconcile ambiguous responses. See [WEBHOOKS.md](WEBHOOKS.md).

Corporate account credit uses integer minor units and locks the account row while checking period usage and creating a booking plus charge in one database transaction; concurrent requests against one account serialize. Customer approval, bookings, charges and cancellation reversal are organization-scoped. This is a ledger of credit usage, not a payment or invoice. Audit records are tenant-scoped, paginated, and deliberately omit secrets; complete coverage of older mutations remains a hardening task. Real two-connection PostgreSQL concurrency and full browser/IDOR acceptance are still required.

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

Historical note: before Step 16, the owner-only **sandbox plan test** was the sole exception to operator-controlled plan assignment. Its separate callback verifies ToyyibPay's documented hash in constant time, matches the stored bill code and organization, and independently checks the exact external attempt ID, RM129 amount, and provider-success status. The return URL alone grants nothing. A locked organization row and attempt state make repeats idempotent; another tenant cannot read or initiate an attempt. The new private table has RLS and revoked PUBLIC grants. Production code disables the route and action via sandbox configuration, and no live subscription or charge exists. A production SaaS plan purchase needs a separate Slotra merchant account, authenticated subscription lifecycle, renewals, invoice/reconciliation logic, and security review.

## Starter reporting and email boundary

Basic reports, customer search, and CSV exports require authenticated organization-scoped role access; CSV also requires centralized `CSV_EXPORT` entitlement. Customer contact data is never available through booking-view-only roles. Export rows are capped and values beginning with spreadsheet formula characters are prefixed before quoting. The server uses private-schema privileged credentials, while the new usage and notification tables retain RLS without browser policies or PUBLIC grants.

Email recipients and booking details are read through organization-scoped joins. Resend credentials and sender identity are server environment values, never database rows or browser props. Notification records avoid storing full provider payloads. A missing provider is not marked sent. Booking success is independent of email delivery, and an outbox retry process is still required for production reliability. The production signup/reset email path remains blocked rather than sending sensitive account links through an unapproved new destination. Do not claim the Starter plan is production-sellable until that delivery path and staff invitations are approved and configured.

`payment:view`, `payment:record_manual`, `payment:refund`, and `payment:manage_settings` are checked in services, not only hidden UI controls. Refund/payment operations use organization-scoped IDs and composite foreign keys; tested IDORs fail. Manual refund records mean staff assert funds were returned outside Slotra. ToyyibPay sandbox bank simulation is not real collection. No real gateway webhook, live refund API, or production credential connection is claimed. Before a live provider launches, review webhook secret rotation, trusted proxy/rate limits, merchant onboarding, dispute/chargeback policy, reconciliation, financial data retention, scheduler health, and independent-connection concurrency.

## Step 14 Business boundary

Business is checked in server services through centralized entitlements and the relevant role permission; a hidden Grow link is never authorization. OWNER/ADMIN manage pricing, membership/package/promo plans, booking policy, and automation templates. Staff booking permissions still govern recurrence, credit redemption, and check-in. Each Business table carries `organization_id`; child associations use composite tenant foreign keys. The server's privileged database connection can bypass RLS, so every query and mutation must also filter by the authenticated organization. Starter/Professional direct server-action calls must fail. New private-schema tables enable RLS without direct browser policies and revoke PUBLIC table access.

Public waitlist signup resolves the organization from the active booking slug, checks Business entitlement, validates the requested space/range, requires a genuinely full slot, and is rate-limited to eight visitor requests per hour. It stores contact details but neither exposes other waiters nor creates an exclusive hold. After cancellation/reschedule, email notification is post-commit best effort. The recipient still competes through the ordinary booking transaction/exclusion constraint. Delivery must not be claimed without a configured email sender; consent, retention, anti-spam, and retry policy need a production review.

Booking QR codes contain a reference and HMAC-SHA256 signature bound to organization and booking ID; no phone, email, name, or payment data is encoded. Staff resolution requires a current organization membership with booking view and Business QR entitlement. Signature comparison is constant-time, and check-in uses the existing `booking:check_in` permission and legal transition. `BOOKING_QR_SECRET` (or the configured auth secret fallback) stays server-side; rotate secrets with a planned invalidation process. The venue storefront QR contains only the public `/book/{slug}` URL.

The internal Business automation runner requires a 32+ character bearer secret. It creates unique workflow/run-key execution claims before action, so normal replay cannot send a duplicate reminder. Execution rows retain safe error summaries, not secrets or provider payloads. Booking reminders are transactional-message templates; inactive-customer automation **only tags** a customer and does not send a promotion. No promotional WhatsApp campaign is sent by default. The WhatsApp interface has a development-only simulator; it is disabled in production and must not be represented as a Meta connection or real delivery. A live provider needs secure credentials, opt-in/consent persistence, approved templates, webhook verification, rate limits, and delivery/retry review. No external scheduler is configured by the repository.
