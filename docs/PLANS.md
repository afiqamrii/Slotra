# Plans and subscriptions

The canonical catalog is `src/lib/plan-entitlements.ts`: prices in MYR minor units, ordering, recommendation, feature inheritance and limits. Presentation copy in `plan-catalog.ts` derives prices from it. Professional is **MOST POPULAR**.

| Plan | Monthly | Annual | Confirmed bookings/month | Active branches | Non-disabled courts/spaces | Owner | Staff |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Starter | RM79 | RM790 | 200 | 1 | 10 | 1 | 1 |
| Professional | RM129 | RM1,290 | 1,000 | 1 | 20 | 1 | 3 |
| Business | RM179 | RM1,790 | 3,000 | 1 | 50 | 1 | 5 |
| Pro | RM279 | RM2,790 | 10,000 | 5 | 1,000 practical cap | 1 | 15 |
| Enterprise | Custom | Custom | Custom | Custom | Custom | Custom | Custom |

Annual means twelve months for the price of ten; it does not grant twelve months of booking allowance at once. Higher plans inherit lower-plan features. Enterprise billing automation is excluded.

- Starter: **Run your bookings.** Public guest booking, staff/walk-in operations, calendar, customers, base pricing/hours, maintenance blocks, manual/pay-at-venue payment tracking, basic reports and CSV. No online gateway, online deposits or provider-managed refunds.
- Professional: **Understand your business.** Everything in Starter plus venue-owned online payments/deposits/refunds where a supported merchant provider is actually connected, business dashboard, filtered reports, utilisation and scheduled-report configuration.
- Business: **Automate and grow.** Everything in Professional plus peak pricing, recurring bookings, memberships/packages/credits, promotions, waitlist, QR, segmentation and automation/channel foundations.
- Pro: **Scale your operation.** Everything in Business plus multi-branch, advanced permissions/audit, executive comparisons, corporate accounts, API and domain/webhook foundations. A flag does not imply live external delivery or custom-domain serving.

## Current subscription implementation

New organizations receive a configurable 14-day Professional trial without a card. Settings → Billing shows effective plan/status, billing cycle, renewal, cancellation, pending changes, monthly usage and history. Settings → Plans stays inside the authenticated workspace and supports monthly/annual choices with an upgrade recommendation and downgrade warnings.

A separate, development-only subscription provider supports all four plans, verified activation/renewal, failed renewal, scheduled downgrade/cycle changes, cancellation/resume and grace expiry. It collects no money and cannot operate in production. Existing organizations are backfilled as **LEGACY** assignments preserving their previous plan; they are not paid subscriptions and do not automatically expire. The older one-time ToyyibPay upgrade is historical compatibility only, not the current billing UI.

Production SaaS checkout is **not connected**. Slotra billing requires a future Slotra-owned production merchant adapter, independent of venue booking merchant accounts. No production subscription charge, invoice, recurring card collection, proration or tax handling is claimed. See [SAAS_BILLING.md](SAAS_BILLING.md).

## Usage and lifecycle

Count one immutable record on first confirmation; later cancellation does not restore allowance. Count `confirmed_at` within the subscription-anchored UTC monthly window, including for annual subscriptions. Legacy assignments retain UTC calendar-month windows. Same-cycle upgrades preserve the existing quota anchor. Downgrades and billing-cycle changes take effect at renewal, preserving records and showing excess resources/branches/staff; new additions are denied at the destination cap.

Starter's temporary booking-quota grace defaults to 10%, configurable from 0–20%; it is not marketed as included allowance. This is distinct from the configurable five-day **renewal grace**. Expired trial, cancelled/expired subscription, exhausted renewal grace or administrative suspension restrict operations while preserving read/basic export/billing access.

Owner seats are fixed at one; there is no second-owner invitation workflow. Active non-owner members count as staff and pending unexpired invitations reserve seats. Resource limits include maintenance spaces but exclude disabled spaces.

## Deployment limitations

Live venue gateways, verified production email/auth delivery, domain serving, outbound webhook delivery and scheduled workers still require their separately documented prerequisites. Billing notices use the existing Resend abstraction and honest DEV_PREVIEW/FAILED states when unconfigured. Membership/package issuance does not itself collect money. Reports describe booked value and net paid, not a financial accounting ledger. Do not present this phase as final production hardening.
