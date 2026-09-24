# Business memberships, credits, and promotions

**Status:** Step 14 code and migrations 0017–0019 are applied to the connected main Supabase project. Browser/mobile and real PostgreSQL concurrency acceptance are pending. Business entitlement plus server role checks protect these workflows. Nothing here creates a customer charge or SaaS subscription.

## Memberships

An owner/admin creates a tenant-owned membership plan with a name, optional description, list price in minor currency units, MONTHLY or ANNUAL billing-period label, optional percentage/fixed booking discount, optional sport/space applicability, optional advance-days value, and optional monthly minutes. Staff manually assign an active plan to a customer for explicit start/end instants. The plan's list price is **not charged**, and status/date alone determine whether the membership is usable for a booking. For a plan with monthly minutes, one assignment may span at most 32 days; renewing and replenishing credits requires a new manual assignment. There is no recurring merchant billing.

An active applicable membership may discount a booking; if several apply, the highest discount is used and capped at the subtotal. For staff creation or rescheduling with an existing selected customer, an active priority membership may extend that resource's advance horizon when its sport/space scope applies, but the venue-wide Business maximum advance policy remains a ceiling. Staff slot lookup and the booking transaction both validate it. The anonymous public slot grid has no verified customer identity and retains the standard advance window; it does not expose a priority-member guest path yet. Membership-benefit usage is not a paid membership sale or reportable membership revenue.

## Package and membership minutes

An owner/admin defines a package with minutes, optional sport/space scope, optional validity days, and a list price. Issuing it to a customer is a manual grant, not a sale. Staff can select an eligible issued package or active membership-credit balance while making a booking. The service checks ownership, active period/expiry, applicability, and enough minutes for the *entire* duration. It locks the balance row within the same booking transaction, subtracts minutes, and inserts exactly one booking-linked usage record. Failed booking creation rolls back the debit. The balance cannot become negative. Cancellation reverses an applied usage once and restores minutes up to the issued total; normal booking quota usage is **not** restored by cancellation.

Example: a customer has 360 package minutes. A 120-minute eligible booking leaves 240 minutes. The booking subtotal is fully offset by the credit, so `total_amount` and due-now can be zero; no online payment success is fabricated. There is no partial-minute split across package and cash, no automatic package purchase, and no renewal scheduler. A later reschedule that would need a financial adjustment is rejected by the existing booking engine rather than silently changing redeemed minutes.

## Promotions

An owner/admin creates a tenant-owned code with fixed or percentage discount, UTC active window, minimum spend, optional maximum discount, total usage cap, per-customer cap, first-booking restriction, and optional sport/space scope. Codes are normalized uppercase and validated server-side inside booking creation. The promotion row is locked before checking/incrementing its count; a redemption records the booking and actual discount. First-booking eligibility uses first-confirmation history, not a self-reported customer claim. An invalid, expired, exhausted, or out-of-scope code is rejected without changing a booking or usage count.

A promo can stack with an active membership discount, but both are capped so the total never falls below zero. A promo cannot combine with a package or membership-credit redemption, and the latter two cannot combine with each other. Promotion counts are not automatically restored after cancellation; any future reuse policy needs an explicit product decision. Public customers can request a code, but the server calculates the actual final total and payment requirement; browser-submitted prices are not trusted.

## Acceptance still required

The migrations were applied after SQL review and isolated tests; verify tenant isolation, concurrent final-credit use, concurrent final-promo use, cancellation re-credit, and guest/staff presentation in a real PostgreSQL development environment. A verified customer purchase/payment linkage is needed before showing membership revenue or packages sold as monetary metrics. See [BOOKING_ENGINE.md](BOOKING_ENGINE.md), [PAYMENTS.md](PAYMENTS.md), and [REPORTING.md](REPORTING.md).
