# Transactional email notifications

## Provider and boundaries

`src/lib/email-delivery.ts` is the single production transactional email boundary. It sends through Resend's HTTPS API using server-only `RESEND_API_KEY`, `EMAIL_FROM`, and optional `EMAIL_REPLY_TO`. It never exposes credentials to client components or stores them in tenant tables. Idempotency keys come from persisted delivery/outbox records where available. HTTP requests have a ten-second timeout, reject redirects, and accept success only with a valid provider message ID. `SENT` means provider acceptance, not a verified inbox delivery; bounce/delivery receipts remain a follow-up.

Email delivery is secondary to booking state. Booking confirmation, rescheduling, and cancellation commit first; a provider rejection or network failure updates the notification record to `FAILED` and does not roll back or duplicate the booking. Scheduled reports and subscription notices also preserve truthful `SENT`, `FAILED`, `PROCESSING`, or development-preview state. A Resend response is considered sent only when the API succeeds and returns a provider message ID.

When configuration is absent or invalid:

- development returns `DEV_PREVIEW`; no external message is sent;
- staging and production return `FAILED`; no delivery is claimed;
- safe structured `email.failed` logs contain a bounded failure code, provider name and HTTP status—never the API key, recipient, subject, body, or raw provider response.

Every Vercel Preview is treated as staging, even if a development mode flag is present. In staging/preview, every recipient must exactly match the comma-separated `STAGING_EMAIL_ALLOWLIST` (case-insensitive); an empty allowlist blocks all sends. Never copy the production sender key into Preview. Use a separately restricted staging key and explicitly approved test recipients. The adapter does not redirect customer emails to a catch-all, which could disclose customer content.

## Templates

`src/lib/email-templates.ts` provides a minimal, responsive HTML/text layout. Dynamic values are HTML-escaped. Accent colors accept six-digit hex and must meet readable contrast against white or use the restrained fallback; venue logos accept HTTPS URLs without embedded credentials. Transactional templates never include internal database IDs, secrets, or private administration links.

Implemented templates:

- booking confirmed, updated, and cancelled;
- trial ending;
- subscription started and renewed;
- subscription payment failed;
- plan upgraded, downgraded, or scheduled to change;
- cancellation scheduled and renewal resumed;
- scheduled venue reports;
- authorized configuration test.

Booking messages use the venue display name, safe logo/accent, contact details, court or space, local date/time, customer-facing reference, and payment summary. `NO_UPFRONT` bookings say **Payment due at venue** and do not imply that online payment is enabled. Cancellation states that any payment/refund handling is separate.

## Authorized test

Settings → Email delivery is available only to an active organization OWNER or ADMIN. The server rechecks membership and sends only to that signed-in user's own account email. The action appears only when the provider configuration is valid and includes no customer data. It is limited to three attempts per actor/organization per hour using the persisted request limiter. Staging recipient restrictions also apply. It is not a public or arbitrary-recipient email endpoint.

## Authentication delivery boundary

Verification, password-reset and staff-invitation links use the process-local inbox only in local development. Hosted Preview, staging and production cannot read that inbox. The account-email boundary now uses the shared Resend adapter when configured, validates the exact `BETTER_AUTH_URL` origin and expected path, rejects external callbacks, requires HTTPS outside loopback development, and hashes link material for idempotency without logging tokens. Missing email configuration blocks signup/reset before account/token creation. Provider acceptance is not an inbox receipt.

Owners with effective organization-wide invitation permission can send or resend a private seven-day invitation. Resending invalidates the prior token. Failed delivery leaves a pending invitation available for retry; no token is exposed in production query strings. Invitation attempts are persistently rate limited. Local development retains copy-link tools for synthetic testing. The Team page checks effective custom permissions before reading member emails.

Automated tests cover all three account-message types, missing/rejected configuration, local inbox isolation, staging restrictions, trusted paths and external callbacks. No live message was sent in the 2026-10-16 audit. Production onboarding still **NEEDS CONFIGURATION / STAGING ACCEPTANCE**: sender/DNS, received verification/reset/invitation flows, expiry/replay, and browser acceptance.

## WhatsApp readiness and consent

The current channel has no live adapter, verified sender, approved template registry, delivery receipt webhook, or persisted consent store. `WHATSAPP_DEV_MODE` can exercise local-only simulated success/failure/delay; hosted deployments always report **Not configured**. An entitlement or a `verified: true` request field cannot establish production consent. The existing interface deliberately rejects non-development delivery.

Before an official Meta Cloud API adapter can send, persist organization/customer/channel/purpose consent with source, policy version, recorded time and revocation time; check the current record at enqueue and dispatch. Operational opt-in and marketing permission must be distinct. Booking alone must not opt a customer into marketing. Provide an opt-out mechanism and suppress queued messages after withdrawal. Retention and approved wording need a documented product/legal review; no compliance guarantee is implied. Configure a venue-owned sender, securely held provider credentials and approved templates, then verify signatures and handle delivery receipts with bounded retries before enabling production sends. Avoid unofficial browser/session automation.

## DNS and sender setup

1. Add the intended sending domain or subdomain in the Resend dashboard.
2. Copy the exact DNS records Resend provides into the authoritative DNS provider. These normally include DKIM and SPF/return-path records; add every required record shown by Resend rather than inventing values.
3. Wait for Resend to show the domain as verified. DNS propagation time depends on the provider.
4. Set `EMAIL_FROM` to a mailbox on that verified domain, for example `Slotra <hello@updates.example.com>`.
5. Set `EMAIL_REPLY_TO` to a monitored plain email address. It may be on another domain if that mailbox is valid.
6. Add a DMARC policy for the organizational domain as part of the production email-security rollout. Start with a monitored policy appropriate to the domain owner.
7. Send the authorized test email, confirm it reaches the inbox, and review SPF/DKIM/DMARC alignment in the received message headers.

Resend's shared development sender is not a production sender-domain substitute. Production release requires the sender domain to be verified for the environment where Slotra runs.

## Operations

Review failed notification, report-delivery, subscription-notification, and automation records. Do not blindly retry an ambiguous network failure: the provider may have accepted it before the connection failed. Reconciliation/webhook-based delivery-state tracking and a bounded retry operator workflow remain follow-ups. Subscription/report/automation runners still require their separately documented protected schedules.
