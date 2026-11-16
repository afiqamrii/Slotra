# Operations

Use Settings → Integrations for an authorized organization-aware summary. Platform infrastructure is operated centrally; a venue owner cannot configure the platform's Resend, storage, cron or monitoring secrets. CONNECTED means the specific evidence described by the check exists, not blanket acceptance of every downstream flow. NOT_CONFIGURED, MISCONFIGURED and DEGRADED must remain distinguishable. Release acceptance is recorded separately in [INTEGRATION_READINESS.md](INTEGRATION_READINESS.md).

## Scheduled work

The chosen architecture is one Vercel Cron endpoint, `GET /api/internal/run-jobs`, using PostgreSQL execution leases and existing domain outboxes. `POST` is available for controlled operator calls. This fits the existing Vercel/Drizzle deployment without a second queue service. It requires `ENABLE_SCHEDULED_JOBS=true`, a 32+ character `CRON_SECRET`, valid core/environment configuration and the applied job-state migration. The request uses `Authorization: Bearer <CRON_SECRET>`; never place the secret in a query string. Staging requires deliberate `ALLOW_STAGING_JOBS=true` as well as its separate database. Do not run ordinary preview jobs.

The deployment cron invokes the runner every five minutes. Confirm the Vercel account's scheduling/runtime limits support that cadence; no provisioned scheduler is claimed. The runner uses bounded batches, a 250-second overall budget, approximately 25 seconds per task, 10-minute leases and fencing tokens. A late worker cannot clear a successor's lease. Task failures back off from five minutes to at most six hours. View `app.background_job_tasks` through authorized operational tooling, never the public health response. A stale lease or overdue last success requires investigation.

| Task | Due cadence | Boundary |
| --- | --- | --- |
| Unpaid hold expiry | 5 minutes | Existing locked expiry service; ordinary booking creation also expires stale holds. |
| Booking email outbox | 5 minutes | Claims queued rows; one persisted event/idempotency key, never invents SENT. |
| Subscription lifecycle | 15 minutes | Existing trial/grace/cancel reconciliation; no new provider charge. |
| Subscription notices | 5 minutes | Existing unique event/recipient claims. |
| Scheduled reports | 15 minutes | Existing weekly/monthly due dates and unique schedule/period/recipient records. |
| Business automations | 5 minutes | Existing reminder/tag workflow claims; no unsolicited marketing. |
| Ephemeral maintenance | 60 minutes | Bounded expired token/rate-counter cleanup, elapsed waitlist status and interrupted delivery reconciliation. |

Usage quotas are calculated from period anchors; no destructive monthly reset job is needed. Membership/package expiry is checked from stored dates by domain services; no automatic renewal/charge is introduced. Waitlist delivery remains a post-commit workflow and does not reserve the slot. WhatsApp delivery and outbound webhook delivery are not silently added to this schedule; see their readiness documents.

Legacy protected endpoints now delegate to the same dispatcher and require `CRON_SECRET`; old per-runner secrets are no longer accepted. Do not schedule the aliases alongside the unified endpoint. A duplicate invocation is expected and tested at the claim boundary, but ambiguous external sends still require reconciliation. Task-level retries do not mean failed messages are blindly resent. A PROCESSING delivery interrupted for over 15 minutes becomes FAILED with an operator-review reason. Resend idempotency is time-limited; consult provider state before requeueing an old/ambiguous send. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) for exact batches and acceptance.

## Incident playbooks

| Symptom | Recovery steps |
| --- | --- |
| Email NOT_CONFIGURED/MISCONFIGURED | Verify environment-scoped key, sender syntax and verified domain. For staging, verify exact recipient allowlist. Do not change booking state. Send only the authorized self-test after correction and check actual inbox/provider logs. |
| Email FAILED / ambiguous PROCESSING | Inspect safe code/message ID and persisted notification event; query the provider dashboard securely. Never print recipient/body/token in logs. Retry only after proving rejection or reconciling prior acceptance. |
| Booking payment callback failure | Identify booking-payment route/provider, verify mode/signature configuration and matching venue account. Reconcile provider amount/reference/status against persisted payment. Replay the original event through the verified handler. Browser redirect is never authority. |
| Late verified payment | Keep an expired/cancelled booking unconfirmed; examine `LATE_PAYMENT_REQUIRES_REFUND`, arrange supported refund separately, and preserve the payment/audit trail. Never reclaim an occupied slot. |
| SaaS renewal/webhook failure | Use separate subscription events/checkouts, catalog snapshots and revision checks. Check grace deadline and provider inquiry. Never repair a subscription by crediting booking payments or extending grace repeatedly. |
| Expired hold still stored | Check expiry task/lease health; invoke the protected runner after target validation. Availability ignores elapsed holds and service creation performs its own locked sweep. Do not manually confirm an expired hold. |
| Job failure / overdue work | Check migration, env guard, cron authorization and invocation logs. Find safe job/run ID, lease and next retry. After the 10-minute lease expires, the runner may reclaim. Do not clear a live lease; reconcile external effects before replay. |
| WhatsApp unavailable/failing | Confirm official provider configuration, approved template, recipient opt-in and opt-out state. Missing credentials/consent is not delivery success. Do not fall back to WhatsApp Web or promotional messaging. |
| Suspended/closed tenant | Inspect platform lifecycle versus subscription state and actor audit. Retain read/export/billing access as designed. Use authorized platform recovery, not direct role/plan changes; billing renewal must not undo administrative suspension. |
| API access denied | Verify active unrevoked key, feature entitlement, scopes, creator permissions, organization/branch restriction and rate window. Never reveal stored hashes as credentials. Rotate a lost key; plaintext cannot be retrieved. |
| Outbound webhook pending | Queue status is not delivery. Do not claim a queued test reached its destination. Complete the egress/worker acceptance in WEBHOOKS.md before enabling a sender. |
| Custom domain pending | Verify exact TXT proof via DNS, hostname uniqueness, deployment registration and TLS. Keep fallback public slug URL active. Never mark active from a typed hostname or TXT proof alone. |
| Storage upload fails | Check private bucket, environment-specific project/secret, size/type policy and provider response status. Preserve existing published branding. Reconcile orphaned objects before any cleanup; no broad bucket delete. |
| Provider outage | Preserve core manual operations and financial history. Stop new unsupported checkout rather than inventing success; retain pending states and reconcile provider events after recovery. |

## Logging and monitoring

Use structured event names and allowlisted context: correlation ID, organization ID where appropriate, route, provider, status and bounded code. The central logger excludes arbitrary request bodies, exception text, email/phone, passwords, tokens, card data and keys. The monitoring adapter sends the same minimal context. Historical logger coverage is not proof every failure path is instrumented; validate important routes/jobs during staging acceptance.

The public `/api/health` checks core config and a minimal database query, returns only `ok` or `unavailable`, and disables caching. It is not a complete migration/provider diagnosis. Uptime checks should also load a synthetic public venue, and authorized operations should check last job success, notification failures and provider discrepancies. Configure an actual alert recipient and prove a safe alert is received before calling monitoring READY.

## Rate limits and proxy boundary

Authentication uses Better Auth's database limiter. Public availability, booking submission/contact, waitlist, payment polling and API keys use bounded database counters. Pro API defaults to 120 requests/minute/key; see API.md. Domain verification, provider self-tests and invitation paths require their own authenticated bounds where implemented. Do not claim CAPTCHA/WAF/bot filtering is configured without deployment evidence.

Production must strip client-supplied forwarding headers at the trusted ingress before the app derives visitor identities. Verify the actual proxy behavior; a hash of a spoofable header is not trusted identity. Keep limits high enough for normal counter/customer use. Counter cleanup is bounded and does not delete bookings or financial history.

## Secret rotation

| Secret | Procedure |
| --- | --- |
| `BETTER_AUTH_SECRET` | Plan the user/session impact, update deployment secret, deploy, revoke sessions if required and verify login/reset. Do not assume old signed tokens remain valid. |
| Resend/API/provider credentials | Create a replacement with minimal scope, install in the correct environment, test safely, revoke old credential and verify failures/usage. Avoid concurrent modes that could create duplicate charges. |
| Incoming payment/subscription webhook secrets | Use provider-supported overlap/versioning if available, update verifier and provider callback together, then expire old secret after replay reconciliation. Keep the domains separate. |
| `CRON_SECRET` | Update scheduler/application in a coordinated rollout, verify one run, then revoke the old token; missing jobs must alert. |
| `SLOTRA_WEBHOOK_SIGNING_KEY` | Rotation changes derived endpoint secrets. Plan endpoint-secret reissue/version migration and notify integration owners through the authorized process before invalidation. |
| API keys | Create scoped replacement, show once to authorized operator, switch integration, revoke prior key and verify denied access. |
| WhatsApp/storage/monitoring | Replace environment-specific scoped credential, test provider read/delivery behavior safely, revoke old value and verify logs contain no secret. |

No secret is rotated automatically by Step 18. Keep values out of command output, support tickets and Git history.

## Retention, closure and privacy

| Data category | Current handling / policy still needed |
| --- | --- |
| Users, organizations, members | Soft lifecycle restrictions preserve relationships; final deletion/export and identity verification require a reviewed procedure. |
| Customers and bookings | Historical business records retained; define venue instructions, rights handling and retention before automated deletion. |
| Payments/refunds/subscriptions | Preserve financial/audit history; legal/accounting retention duration remains unapproved. |
| Audit records | Retained, tenant-scoped and paginated; set access/retention policy with the operator. |
| Notifications and webhooks | Retain delivery/event IDs needed for reconciliation/idempotency; redact payloads and choose approved retention. No historical purge is introduced. |
| Auth verifications/rate counters | Only already expired/stale ephemeral rows are bounded-cleaned after the documented safety window. |
| Storage | Define stale-object and closure handling; no automatic destructive cleanup. |

Closure does not cascade-delete bookings, payments, refunds, audit or subscription history. Before a future permanent deletion/export: verify requester authority, outstanding financial obligations, retention/legal requirements and backup handling; stage/review the exact tenant scope. No invasive product telemetry is introduced; any later analytics needs a separate purpose/consent/retention review. Support contacts come from central configuration, not a personal developer address.
