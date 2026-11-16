# Plans and feature entitlements

**Status:** Central entitlements now resolve effective subscription/trial/lifecycle plus expiring support overrides. Monthly/annual development subscription checkout is implemented; no live SaaS billing provider is connected. A true flag is not proof of a configured external provider. See SAAS_BILLING.md.

| Plan | Monthly | Confirmed bookings/month | Positioning |
| --- | ---: | ---: | --- |
| Starter | RM79 | 200 | Run your bookings. |
| Professional | RM129 | 1,000 | Understand your business. |
| Business | RM179 | 3,000 | Automate and grow. |
| Pro | RM279 | 10,000 | Scale your operation. |

`src/lib/plan-entitlements.ts` is the centralized catalog for prices, order, recommendation, limits and inherited features. `organization-entitlements.ts` uses `subscription-access.ts`: effective dated subscription, Professional trial, administrative lifecycle and newest unexpired override per key. `organizations.plan_code` is a server-owned compatibility mirror, used for preserved LEGACY assignments. UI previews are not security controls; service checks enforce permissions, tenant/branch scope and effective entitlements. Restricted venues retain basic read/export/billing access but cannot mutate operations. Overrides cannot bypass suspension.

| Starter limit | Value | Enforcement |
| --- | ---: | --- |
| `MONTHLY_BOOKINGS` | 200 | First transition to `CONFIRMED` creates one immutable usage record. |
| `BRANCHES` | 1 | Second-branch creation checks the plan and is denied below Pro. |
| `RESOURCES` | 10 | Non-disabled spaces count, including maintenance. Creation/reactivation is guarded. |
| `OWNER_SEATS` | 1 | Organization creation assigns one owner; no owner invitation workflow. |
| `STAFF_SEATS` | 1 | Every active non-owner role counts; pending unexpired invitations reserve the seat. |

Starter permits public/guest, staff and walk-in booking, customer records, basic reports, CSV export, manual payments and tracking. It denies online gateway checkout, deposits, provider-managed online refunds, advanced analytics/reports/schedules, memberships, packages, WhatsApp, automations, multi-branch, custom domain, and API access. Professional and higher inherit Starter. Professional centrally enables `ONLINE_PAYMENTS`, `DEPOSITS`, `ONLINE_REFUNDS`, `ADVANCED_ANALYTICS`, `ADVANCED_REPORTS`, and `SCHEDULED_REPORTS`; a live merchant gateway and scheduled email delivery still need external configuration. Business adds the domain keys below. Pro adds the keys and limits in the next section; external-domain/webhook readiness is described separately.

| Professional limit | Value |
| --- | ---: |
| `MONTHLY_BOOKINGS` | 1,000 first confirmations |
| `BRANCHES` | 1 |
| `RESOURCES` | 20 non-disabled spaces |
| `OWNER_SEATS` | 1 |
| `STAFF_SEATS` | 3 active non-owner members (pending invitations reserve a seat) |

Professional report definitions and schedule gates are in [REPORTING.md](REPORTING.md). Verified development subscriptions now support self-service activation and renewal; production billing is not connected.

| Business limit | Value |
| --- | ---: |
| `MONTHLY_BOOKINGS` | 3,000 first confirmations |
| `BRANCHES` | 1 |
| `RESOURCES` | 50 non-disabled spaces |
| `OWNER_SEATS` | 1 |
| `STAFF_SEATS` | 5 active non-owner members; pending invitations reserve a seat |

Business inherits all Professional flags, then enables `DYNAMIC_PRICING`, `RECURRING_BOOKINGS`, `MEMBERSHIPS`, `PACKAGES`, `CREDITS`, `PROMOTIONS`, `WAITLIST`, `QR_CHECK_IN`, `WHATSAPP`, `AUTOMATIONS`, `CUSTOMER_SEGMENTATION`, `RETENTION_TOOLS`, and `ADVANCED_BOOKING_RULES`. Starter and Professional return false for each of these keys. The implementation must call `requireOrganizationFeature` at every Business mutation/read boundary; hiding a Grow link is insufficient. Plan limits are enforced at the same existing resource, seat, and first-confirmation checkpoints. Setting `WHATSAPP` true only expresses commercial entitlement; it does not imply a connected production provider or delivered messages.

| Pro limit | Value |
| --- | ---: |
| `MONTHLY_BOOKINGS` | 10,000 first confirmations |
| `BRANCHES` | 5 active branches |
| `RESOURCES` | 1,000 non-disabled spaces (practical cap, not unlimited) |
| `OWNER_SEATS` | 1 |
| `STAFF_SEATS` | 15 active non-owner members; pending invitations reserve a seat |

Pro inherits Business and enables `MULTI_BRANCH`, `CUSTOM_DOMAIN`, `WHITE_LABEL`, `ADVANCED_PERMISSIONS`, `AUDIT_LOGS`, `API_ACCESS`, `WEBHOOKS`, `CORPORATE_ACCOUNTS`, `EXECUTIVE_REPORTS`, and `BRANCH_COMPARISON`. Services reject lower-tier direct calls. `CUSTOM_DOMAIN` currently permits verification-ready configuration, not live hostname activation. `WEBHOOKS` currently permits signed queue/configuration and history, not outbound delivery. See [CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md) and [WEBHOOKS.md](WEBHOOKS.md).

## Booking usage

Subscription usage is range-counted by first `confirmed_at` inside an anchored UTC monthly window; annual billing still receives a monthly allowance. LEGACY assignments retain UTC calendar-month windows. Existing immutable usage rows are not rewritten. Cancellation does **not** restore usage; unconfirmed holds/failures do not count. The organization row serializes confirmations across courts, and migration 0023 indexes the organization/confirmation range.

At 70%, 80%, and 90%, the owner dashboard shows progressively important usage context. At 200 included bookings, a configurable temporary grace (`STARTER_BOOKING_GRACE_PERCENT`, default 10, maximum 20) keeps existing and new booking operations functioning through 220 confirmations. Grace is not advertised as plan allowance. At 220, new confirmations are denied server-side; public customers see a neutral unavailable-venue message, not a billing explanation. Existing bookings remain manageable. A paid online hold that arrives after expiry or when confirmation cannot be retained is not double-booked; it is recorded for refund review.

Existing resources, branches and staff are never silently deleted or disabled on downgrade. New additions are blocked at the destination cap. Same-cycle verified upgrades preserve the usage anchor; downgrades and cycle switches take effect at renewal. Settings → Billing/Plans shows development-only checkout, never a live recurring purchase. The older ToyyibPay plan test is historical compatibility, not the current subscription UI.

## Reporting definitions

Basic reports are based on booking start date in the first branch's timezone. Booking value is booked total for non-cancelled, non-expired bookings. Collected is net `bookings.amount_paid` allocated to bookings scheduled in the selected period, **not** cash collected during that period. Outstanding is nonnegative total minus paid for non-cancelled/non-expired bookings. Counts include booking states in the period; completed and cancelled are shown separately. The activity chart offers bookings, booking value, and newly created customer records by day or month; it is not customer-retention analytics.

CSV exports are capped at 10,000 rows per request, tenant-scoped and role-checked, and prefix spreadsheet-formula characters to reduce CSV injection. Customer export contains contact PII, so only roles with `customer:view` may request it. No internal IDs are exported.

See [PLANS.md](PLANS.md) for the customer-facing Starter scope and remaining production prerequisites.
