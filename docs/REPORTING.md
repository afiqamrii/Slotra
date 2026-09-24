# Professional reporting

Professional (RM129/month) and higher plans unlock the business dashboard, filtered reports, and report schedules. Starter keeps its basic dashboard/reports. Server services and exports check both the centralized feature entitlement and authenticated organization-scoped permission; UI locks are not security controls. Owner and admin can configure schedules. Manager can view/export Professional reports. Staff and viewer retain their ordinary operational screens, not financial analytics.

## Definitions

All report periods use the active branch's IANA timezone. Today, this/last month, and chart/heatmap buckets are **local** dates and hours. Custom ranges are capped at 93 days to bound work; Professional is single-branch. Bookings are attributed to their scheduled local start date, even if payment arrives later.

- **Booking value:** total amount in minor currency units for CONFIRMED, CHECKED_IN, IN_PROGRESS, COMPLETED, and NO_SHOW bookings scheduled in the period. Cancelled, expired, and unpaid holds are excluded. A no-show can still have a payable total.
- **Collected:** net `bookings.amount_paid` on bookings scheduled in the period, including any retained payment on cancelled bookings. This is **not** cash received during the period or a ledger. Refunds reduce this net amount through the payment service.
- **Outstanding:** nonnegative total less net paid on non-cancelled, non-expired counted bookings.
- **Refunds:** succeeded refund records whose last update is in the period and whose booking is scheduled in the period. The schema lacks a dedicated succeeded-at timestamp; this is an operational indicator, not accounting reconciliation.
- **Cancellation rate:** CANCELLED / all bookings starting in period; cancellation value is cancelled booking total. Expired holds are separate.
- **No-show rate:** NO_SHOW / bookings with a confirmed or later lifecycle state in the period. When denominator is zero, show no rate rather than 0%.
- **New customer:** a customer with a booking in the period whose first confirmation timestamp is in the period. **Returning:** the customer's first confirmation was earlier. Guests without a linked customer/confirmation record are excluded from these classifications.
- **Peak day/period and heatmap:** counts starts of confirmed-or-later bookings in local Monday–Sunday and two-hour bins. This is a booking-start heatmap, not minute-by-minute occupancy. Ties choose the earliest weekday/period deterministically.
- **Resource revenue:** booking value attributed to the booked resource, not money collected at that resource.

## Utilization

For each active resource, utilization is `booked usable minutes / available operating minutes`. The service builds branch opening windows and resource-specific intersections with the same time-window helper used by availability. It clips and merges them to the selected local-date range, subtracts the union of resource blocks (including temporary maintenance), then intersects eligible booking intervals with that usable time. Overlaps are merged so minutes are not double-counted. CLOSED days contribute no denominator. Venue utilization uses total booked minutes over total available minutes, not an average of resource percentages. A zero denominator displays “—”.

The current `resources.status = MAINTENANCE` has no status history, so a resource currently in maintenance is excluded from the entire selected period; use timed maintenance blocks for accurate historical slices. Prior opening-hour edits and past reschedules are not reconstructed from audit history. This is an operational utilization estimate, not a historical ledger.

## Implementation and performance

`professional-reporting.ts` validates filters and tenant/resource ownership, caps raw booking rows at 10,000 per request, and batch-loads bookings, hours, blocks, first-confirmation aggregates, and refunds rather than querying each resource. The first-confirmation aggregate stays in PostgreSQL. Relevant booking and block indexes already exist. Current limits are 20 resources and 1,000 first confirmations per month on Professional. No cross-tenant cache is used; correctness is preferred while report volumes are small. Investigate query plans and add partitioned aggregates before raising limits significantly.

The Reports page has Overview, Revenue, Bookings, Courts & spaces, and Customers tabs with period, sport, resource, and status filters. Filtered CSV includes local period, timezone, currency, readable headers, and spreadsheet-formula protection. Amounts in the CSV are explicitly labelled **minor units**. XLSX and PDF are not implemented; do not label CSV as Excel/PDF.

## Scheduled reports

`report_schedules` stores tenant-scoped owner configuration (type, weekly/monthly cadence, up to five recipients, timezone snapshot, next run). `report_deliveries` stores each recipient/period attempt with a unique key. The protected `POST /api/internal/run-reports` runner requires a 32+ character `REPORT_RUNNER_SECRET` bearer token; without it, the endpoint returns 503. A deployment scheduler must call it. Weekly sends Monday 9 AM for the previous Monday–Sunday; monthly sends the first day at 9 AM for the previous calendar month.

The runner reuses the same analytics service and the existing Resend email abstraction. Without `RESEND_API_KEY` and a verified `EMAIL_FROM`, development records `DEV_PREVIEW` and production records `FAILED`, never `SENT`. The settings page says email is not configured. Per-period/recipient uniqueness prevents duplicate sends from normal runner replays. Resend's idempotency key uses the delivery ID. Failed/indeterminate attempts are not silently retried because a provider may have accepted the email before a network failure; an operator retry/reconciliation mechanism is a follow-up. No runner scheduler or production sender is configured by this repository.

## Step 14 Business operational analytics

Business inherits the Professional report service and its branch-local, maximum 93-day filter window. `business-analytics.ts` adds tenant-scoped, role- and feature-gated benefit/retention metrics; it is not a revenue ledger or executive multi-branch report. Its current definitions are:

- **Memberships:** active customer memberships at the observation instant; active plan count; and bookings in the selected period made while a customer membership was active. The member-booking metric does not check plan sport/space applicability or prove a discount/credit was redeemed; that usage metric is not provided. Membership revenue is deliberately **Not tracked** because a staff assignment is not a payment.
- **Packages:** customer packages issued in the selected period; applied minutes on counted bookings starting in the period; remaining active minutes at the observation instant; and active packages with positive minutes expiring within 30 days. “Packages sold” is **Not tracked** until an actual sale/payment linkage exists. Cancellation-reversed use is excluded.
- **Promotions:** redemption count, saved discount in minor units, and the resulting booking value for counted bookings starting in the period. A promo's influence is not a causal revenue-lift measurement.
- **Retention:** inactive 30/60 counts and regular-inactive count from deterministic customer segments, plus the Professional report's new/returning counts and rate. This remains booking-history analysis, not automatic marketing consent.

`business-segments.ts` uses organization-scoped customer/bookings aggregates, with an explicit cap of 20,000 customer rows per request. New means customer record created within 30 days. Returning means at least two past non-cancelled/non-no-show bookings. Frequent means at least four such bookings in the trailing 90 days. High spender means the top 10% of historical booked value among customers with at least two bookings. Inactive 30 means the latest past booking is 30–59 days old and no future booking exists; Inactive 60 means at least 60 days old with none upcoming. Regular-inactive 30+ means at least three past bookings, none upcoming, and last booking at least 30 days old. Manual tags are tenant-scoped and not AI labels. These definitions need product review if the venue wants a different threshold or treatment of cancelled/no-show visits.

There is no Pro multi-branch comparison, package-sales accounting, membership billing, or automated customer outreach in this report. Browser/mobile acceptance and a larger real PostgreSQL dataset remain pending.
