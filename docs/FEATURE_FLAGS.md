# Plans and feature entitlements

**Status:** Starter/Professional operational entitlements and quotas are enforced in server services. Business entitlements and the Step 14 domain gates are being added; a true flag is not proof that a feature has passed deployment acceptance. A development-only, provider-verified Professional sandbox upgrade test exists; live SaaS subscription purchase, renewal, general self-service upgrades, trials, and trusted operator overrides are not implemented.

| Plan | Monthly | Confirmed bookings/month | Positioning |
| --- | ---: | ---: | --- |
| Starter | RM79 | 200 | Run your bookings. |
| Professional | RM129 | 1,000 | Understand your business. |
| Business | RM179 | 3,000 | Automate and grow. |
| Pro | RM279 | 10,000 | Scale your operation. |

`src/lib/plan-entitlements.ts` is the centralized `plan → limits → features` source. `organizations.plan_code` is server-owned and defaults to Starter. `organization-entitlements.ts` resolves it for service checks. UI previews are not security controls; payment-provider actions, deposits, online refunds, resource creation/reactivation, staff invitations, and booking confirmation are checked server-side. Reporting and CSV routes check feature entitlement plus role permission and organization scope. A future trusted override/trial resolver can wrap this lookup without scattering plan-name checks.

| Starter limit | Value | Enforcement |
| --- | ---: | --- |
| `MONTHLY_BOOKINGS` | 200 | First transition to `CONFIRMED` creates one immutable usage record. |
| `BRANCHES` | 1 | Onboarding creates the first branch; no second-branch creation endpoint exists. |
| `RESOURCES` | 10 | Non-disabled spaces count, including maintenance. Creation/reactivation is guarded. |
| `OWNER_SEATS` | 1 | Organization creation assigns one owner; no owner invitation workflow. |
| `STAFF_SEATS` | 1 | Every active non-owner role counts; pending unexpired invitations reserve the seat. |

Starter permits public/guest, staff and walk-in booking, customer records, basic reports, CSV export, manual payments and tracking. It denies online gateway checkout, deposits, provider-managed online refunds, advanced analytics/reports/schedules, memberships, packages, WhatsApp, automations, multi-branch, custom domain, and API access. Professional and higher inherit Starter. Professional centrally enables `ONLINE_PAYMENTS`, `DEPOSITS`, `ONLINE_REFUNDS`, `ADVANCED_ANALYTICS`, `ADVANCED_REPORTS`, and `SCHEDULED_REPORTS`; report services and exports enforce both role and plan. A live merchant gateway and scheduled email delivery still need external configuration. Business enables the keys below; server services must still check each key and role, and some external-channel capabilities remain unconfigured. Pro-only domain features remain a future phase.

| Professional limit | Value |
| --- | ---: |
| `MONTHLY_BOOKINGS` | 1,000 first confirmations |
| `BRANCHES` | 1 |
| `RESOURCES` | 20 non-disabled spaces |
| `OWNER_SEATS` | 1 |
| `STAFF_SEATS` | 3 active non-owner members (pending invitations reserve a seat) |

Professional report definitions and schedule gates are in [REPORTING.md](REPORTING.md). Subscription billing and trusted self-service plan assignment remain future work.

| Business limit | Value |
| --- | ---: |
| `MONTHLY_BOOKINGS` | 3,000 first confirmations |
| `BRANCHES` | 1 |
| `RESOURCES` | 50 non-disabled spaces |
| `OWNER_SEATS` | 1 |
| `STAFF_SEATS` | 5 active non-owner members; pending invitations reserve a seat |

Business inherits all Professional flags, then enables `DYNAMIC_PRICING`, `RECURRING_BOOKINGS`, `MEMBERSHIPS`, `PACKAGES`, `CREDITS`, `PROMOTIONS`, `WAITLIST`, `QR_CHECK_IN`, `WHATSAPP`, `AUTOMATIONS`, `CUSTOMER_SEGMENTATION`, `RETENTION_TOOLS`, and `ADVANCED_BOOKING_RULES`. Starter and Professional return false for each of these keys. The implementation must call `requireOrganizationFeature` at every Business mutation/read boundary; hiding a Grow link is insufficient. Plan limits are enforced at the same existing resource, seat, and first-confirmation checkpoints. Setting `WHATSAPP` true only expresses commercial entitlement; it does not imply a connected production provider or delivered messages.

## Booking usage

Until subscription billing exists, `usagePeriod()` uses a UTC calendar month. Each `booking_usage_records` row stores the period boundaries and first confirmation instant so later billing-period logic can be changed without rewriting historical usage. Later cancellation does **not** restore usage. Unconfirmed holds, failures, and expired bookings do not count. Migration 0013 backfills the earliest CONFIRMED history event per existing booking. The organization row serializes confirmations across different courts.

At 70%, 80%, and 90%, the owner dashboard shows progressively important usage context. At 200 included bookings, a configurable temporary grace (`STARTER_BOOKING_GRACE_PERCENT`, default 10, maximum 20) keeps existing and new booking operations functioning through 220 confirmations. Grace is not advertised as plan allowance. At 220, new confirmations are denied server-side; public customers see a neutral unavailable-venue message, not a billing explanation. Existing bookings remain manageable. A paid online hold that arrives after expiry or when confirmation cannot be retained is not double-booked; it is recorded for refund review.

Existing resources and staff are never silently deleted or disabled on a plan downgrade. Their current use may exceed the new cap; additional creation/reactivation or invitations are blocked until the venue is under the limit. The UI must not imply a **live recurring** plan purchase is available. The isolated Starter → Professional ToyyibPay sandbox test is labelled as nonproduction, owner-only, and one-time.

## Reporting definitions

Basic reports are based on booking start date in the first branch's timezone. Booking value is booked total for non-cancelled, non-expired bookings. Collected is net `bookings.amount_paid` allocated to bookings scheduled in the selected period, **not** cash collected during that period. Outstanding is nonnegative total minus paid for non-cancelled/non-expired bookings. Counts include booking states in the period; completed and cancelled are shown separately. The activity chart offers bookings, booking value, and newly created customer records by day or month; it is not customer-retention analytics.

CSV exports are capped at 10,000 rows per request, tenant-scoped and role-checked, and prefix spreadsheet-formula characters to reduce CSV injection. Customer export contains contact PII, so only roles with `customer:view` may request it. No internal IDs are exported.

See [PLANS.md](PLANS.md) for the customer-facing Starter scope and remaining production prerequisites.
