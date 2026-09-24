# Business automations and notifications

**Status:** Step 14 code and migration 0018 are applied to the connected main Supabase project. The runner is implemented but has no deployed external schedule. No live WhatsApp provider, persisted messaging consent, or production sender configuration is supplied by this repository.

## Template-first workflow model

Business owners/admins can add up to ten workflows from three supported templates:

| Template | Trigger → action | Current effect |
| --- | --- | --- |
| 24-hour reminder | `BOOKING_REMINDER → EMAIL_REMINDER` | Email a confirmed booking customer near the 24-hour lead time. |
| 2-hour reminder | `BOOKING_REMINDER → EMAIL_REMINDER` | Email a confirmed booking customer near the two-hour lead time. |
| Inactive for 30 days | `CUSTOMER_INACTIVE → TAG_INACTIVE` | Add a tenant-scoped `Inactive` tag; send no marketing message. |

`automation_workflows` stores tenant, trigger/action, bounded template configuration, active state, creator, and last-run time. `automation_executions` stores per-target outcomes and a unique workflow/run key. No credential or arbitrary executable code belongs in workflow JSON. The owner UI shows recent outcomes and configuration readiness; it is not a node-based workflow builder.

## Runner and idempotency

`POST /api/internal/run-business-automations` requires a 32+ character `BUSINESS_AUTOMATION_RUNNER_SECRET` bearer token. A deployment scheduler must call it; without the secret the route is unavailable. Each run scans a bounded number of active Business workflows and tenant-scoped targets. A reminder targets only `CONFIRMED` bookings whose start is within the 30-minute due window around its lead time. It claims a unique workflow/booking/start/lead run key before calling email delivery. The Resend idempotency key is the execution ID. A repeat runner call does not create a second normal reminder. Missing email becomes `SKIPPED`; development without a sender becomes `DEV_PREVIEW`, **not sent**; configured delivery may become `SENT`; failures are recorded safely without provider payloads.

The inactive template selects customers with past counted bookings, no existing case-insensitive `Inactive` tag, and a latest booking at least 30 days old. It adds the tag idempotently; it does not infer marketing consent, schedule a campaign, or send a promotional message. Automation work is outside the booking transaction, so a message failure cannot undo a confirmed booking.

An uncertain provider failure after a run-key claim is **not automatically retried**: replay may have already been accepted by the provider. Operations need a reconciliation/manual retry policy before production promises of guaranteed delivery. The bounded 30-minute reminder window also means a disabled or late scheduler can miss a reminder rather than sending a misleading near-start “24-hour” notice. A verified `RESEND_API_KEY` and `EMAIL_FROM`, external scheduler, monitoring, and failure review are required for production email delivery.

## WhatsApp boundary

`whatsapp-provider.ts` is an adapter interface for future approved provider templates. `WHATSAPP_DEV_MODE` can simulate SUCCESS, FAILURE, or DELAYED in development and the Grow UI labels this as a synthetic test that contacts no customer. It is disabled in production and is not a Meta WhatsApp Cloud API connection. A real integration needs venue sender onboarding, server-held rotating credentials, opt-in/consent storage, approved transactional templates, webhook signature/idempotency checks, provider error mapping, rate limits, and delivery monitoring. Promotional messages are not enabled by default.

The waitlist notification is separate from workflow delivery: when cancellation/reschedule makes a requested slot eligible, `business-waitlist.ts` may send one post-commit best-effort email through the configured email adapter. It reserves no slot and does not promise a 15-minute window. A dedicated reliable outbox/retry policy remains future work. See [SECURITY.md](SECURITY.md) and [BOOKING_ENGINE.md](BOOKING_ENGINE.md).
