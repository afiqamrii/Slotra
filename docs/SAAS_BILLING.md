# SaaS billing

This domain is **venue → Slotra**, not **customer → venue**. It never creates booking payment/refund records, uses venue merchant credentials, or treats venue booking revenue as Slotra revenue. See [PLANS.md](PLANS.md) for exact prices/limits.

## State and authority

`organization_subscriptions` is authoritative for new tenants: plan, MONTHLY/ANNUAL cycle, provider IDs, dated period/trial, grace, cancellation, pending change and monotonic revision. `organizations.plan_code` is a compatibility mirror, not an owner-controlled entitlement. Effective access is computed on every server check, including expiry when the runner has not run.

New organization/owner/subscription/audit creation is transactional. Default trial is Professional for 14 days (`SAAS_TRIAL_DAYS`, bounded 1–90), no card. Trial expiry becomes EXPIRED and restricted. No automatic paid conversion.

ACTIVE → missed period → GRACE; a verified failed invoice records PAST_DUE. The default grace is five days (`SAAS_GRACE_DAYS`, bounded 1–14), starting at the first failure but never later than the renewal boundary. Repeated failures do not extend grace; a delayed first failure after that deadline cannot reopen access. Exhausted grace → SUSPENDED. Cancel-at-period-end retains access until the boundary, then CANCELLED. Administrative suspension/closure remains sticky across billing events.

Owner alone may change subscriptions; owner/admin may view billing. Browser redirects/checkout page reads never activate access. A signed verified event must match organization, subscription, checkout snapshot, provider checkout ID, exact server amount/currency, expiry and current revision. Organization then subscription rows are locked in that order. Provider event IDs are unique, and event claim plus state/audit/outbox changes share one transaction. Duplicate/stale events cannot double-activate, regress state or reset quota. Repeated checkout requests reuse the same pending attempt and provider idempotency key.

## Changes and usage

Same-cycle upgrades activate after verified payment and preserve the current period/quota anchor. Current development simulation uses the catalog upgrade charge, without claiming production proration. Downgrades and all billing-cycle switches are scheduled for renewal. Server recalculates renewal price from the pending/current catalog selection, clears pending state and advances from the previous period boundary. Late events for a fully elapsed renewal period are ignored and require reconciliation; do not silently shift quota dates.

All dates are UTC instants. Annual paid periods span twelve months but usage is monthly, anchored to the original start day with month-end/leap-year clamping. Immutable confirmation records are range-counted by confirmed_at; historical rows are not rewritten. Organization locks serialize quota enforcement across resources. A subscription revision prevents concurrent checkouts from granting two different changes.

Destination caps are enforced on new branch/resource/staff additions and first confirmations. Existing excess data remains visible, not deleted or silently disabled. Operational mutation is denied for expired/suspended/closed tenants; existing basic read/export and owner billing remain available. Support overrides cannot bypass suspension.

## Provider abstraction and simulator

`SubscriptionBillingProvider` is separate from booking `PaymentProvider`: checkout, update, cancellation, inquiry and verified normalized webhook, including opaque provider subscription/customer/checkout IDs. Only `DevelopmentSubscriptionProvider` is registered now. Future production adapters must preserve these validation/idempotency boundaries and use Slotra's merchant account.

Enable locally with NODE_ENV=development, ENABLE_DEV_SUBSCRIPTIONS=true and DEV_SUBSCRIPTION_WEBHOOK_SECRET of at least 32 characters. Production always disables the simulator regardless of flags. No SDK or real provider success is faked.

Routes:

- /settings/billing — plan, lifecycle, usage, cancellation and history
- /settings/plans — monthly/annual choices, Professional recommendation, downgrade warnings
- /settings/billing/checkout/[id] — explicitly labelled test result controls
- /settings/billing/simulator — trial, expiry, renewal and failure clock controls
- POST /api/subscription-webhooks/development — raw-body HMAC-SHA256 verification; x-slotra-subscription-signature header
- POST /api/internal/run-jobs — unified lifecycle/notification dispatcher, enabled by `ENABLE_SCHEDULED_JOBS=true` and Bearer `CRON_SECRET` (minimum 32 characters); the legacy `/api/internal/run-billing` URL delegates to it

The simulator signs events server-side and uses the same handler as the webhook. Checkout lasts 30 minutes. Payloads are bounded to 8 KiB and parsed with Zod after signature verification. No secrets are stored in subscription rows or audit JSON.

## Notices and reconciliation

Transactionally enqueue distinct owner notices for activation, upgrade, downgrade, renewal/failure, scheduled changes/cancellation and impending trial expiry. Unique organization/event/recipient keys avoid duplicates. The protected runner processes bounded batches (200 lifecycle candidates; 100 notices), claims each notice before delivery, and uses Resend idempotency keys. Missing sender gives DEV_PREVIEW outside production or FAILED in production, never fake SENT.

The runner is not deployed/scheduled automatically. Configure a protected external scheduler and verified Resend sender before launch. FAILED/ambiguous PROCESSING notices require operator reconciliation; no unbounded automatic retry is claimed. Provider inquiry/reconciliation, invoices, taxes, production proration, recurring collection and full notification-copy/localization remain future production-adapter work.

## Migration and legacy compatibility

0022 adds six private app tables, platform role and organization lifecycle fields. Existing organizations get ACTIVE/LEGACY subscriptions with their exact previous plan and an audit record. No old booking/payment data is deleted or charged. 0023 adds organization/confirmed_at usage indexing. New tables enable RLS and revoke PUBLIC/anon/authenticated access; the privileged application server must still authorize every query.

## Acceptance

Isolated tests cover trial/expiry, every plan, monthly/annual pricing, anchor preservation, downgrade/cancel, renewal grace/recovery, signed and duplicate/stale/forged events, usage caps, cross-tenant and staff denial, admin operations/override expiry, non-revenue MRR, domain separation and production simulator guards. PGlite exercises SQL transactions but does not replace independent-connection production PostgreSQL concurrency acceptance. Browser verification status is recorded in ROADMAP.md.
