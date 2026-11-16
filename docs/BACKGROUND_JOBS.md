# Scheduled jobs

Status: **NEEDS CONFIGURATION**. The dispatcher and isolated tests exist. No external schedule, database migration, provider delivery, or production execution has been activated by this step.

## One scheduler

The intended scheduler is Vercel Cron calling `GET /api/internal/run-jobs` every five minutes. The default `vercel.json` does **not** install a schedule: the current deployment target rejects sub-daily cron, and a daily fallback would miss the reminder due window. The exact opt-in configuration is preserved in [examples/vercel-scheduled-jobs.json](examples/vercel-scheduled-jobs.json). An example file does not activate jobs.

The existing PostgreSQL outboxes remain the work queues; no separate queue vendor is required for the current bounded workloads. The intended schedule requires a Vercel plan supporting sub-daily cron and a 300-second function. After verifying those limits, isolated staging acceptance and the controls below, add the example's `crons` entry to the actual root `vercel.json` in a reviewed release. Keep its five-minute cadence; do not replace it with daily execution to pass plan validation. The route also accepts POST for a deliberately configured scheduler/manual recovery. Do not schedule both transports. Vercel Cron normally runs only for a project's production deployment; a separate staging project can use its production deployment with `DEPLOYMENT_ENV=staging` and isolated credentials/database.

Until scheduling is accepted, retain `ENABLE_SCHEDULED_JOBS=false`. Ordinary manual/pay-at-venue bookings remain available: availability already ignores expired payment holds and booking creation expires stale holds under its resource lock. This does not run background outbox recovery, reports, reminders, subscription reconciliation or maintenance tasks. Live online payments and scheduled automation must not be presented as operational without their separate acceptance evidence.

Required controls: `ENABLE_SCHEDULED_JOBS=true`, server-only `CRON_SECRET` with at least 32 random characters, and a valid core deployment/database target. Staging additionally requires `ALLOW_STAGING_JOBS=true`, explicit `DEPLOYMENT_ENV=staging`, and the approved staging database fingerprint plus production fingerprint denylist. Ordinary preview jobs are disabled. Do not enable jobs before reviewing the target and email recipient allowlist.

Legacy POST URLs (`run-billing`, `run-reports`, `run-business-automations`, `expire-payment-holds`) delegate to the same central dispatcher and require `CRON_SECRET`; older per-runner secrets are no longer accepted. Disable old external schedules during rollout to avoid redundant invocations.

| Task | Cadence | Bounded work |
| --- | --- | --- |
| Payment hold expiry | 5 minutes | Existing resource-locked service, 25 candidates |
| Booking email outbox | 5 minutes | 25 pending rows, atomic notification claims |
| Subscription lifecycle | 15 minutes | Existing lifecycle service, at most 200 candidates |
| Subscription email | 5 minutes | Existing claimed outbox, at most 100 candidates |
| Scheduled reports | 15 minutes | At most 20 due schedules; unique schedule/period/recipient claims |
| Business automations | 5 minutes | At most 20 workflows and 100 targets/workflow |
| Ephemeral maintenance | Hourly | At most 500 expired tokens, 500 stale counters, 200 elapsed waitlist entries, 100 interrupted rows per outbox |

Every invocation stops starting tasks near its 250-second budget. Email/report/automation loops stop between items; each task receives a 25-second scheduling budget with a provider timeout supplied by the shared email adapter. An in-flight database query or provider request can finish beyond a loop deadline; the 300-second platform function limit remains the final ceiling. Monitor duration and queue lag; increase throughput deliberately before volume exceeds these bounds. Production booking payments remain disabled until their separate gateway and expiry acceptance requirements pass.

## Claims, retries, and evidence

`app.background_job_tasks` is platform-owned state, protected by RLS and no browser grants. Each task atomically claims a ten-minute lease with a random run identifier, commits that claim, then performs work. No session advisory lock or database transaction spans provider HTTP requests, so transaction-pooler connections are safe. A crashed lease can be reclaimed; the run identifier fences late results from an older worker. Per-task timestamps record due/start/finish/latest-success, consecutive failures, a safe error code and aggregate counts only.

A thrown task failure backs off 5, 10, 20, 40, 80, 160, 320 and then 360 minutes. Other tasks continue. Overlapping invocations cannot claim the same unexpired task; domain outbox keys remain the final duplicate-send defense. Successful tasks wait their normal cadence. Integration settings only show scheduler health as connected after every known task has successful execution evidence and none is failed, expired, or overdue.

Booking notifications use an atomic `PENDING → PROCESSING` claim before delivery. Failed or interrupted notifications are **not blindly retried**: an interrupted call may already have reached Resend, whose idempotency retention is finite. Hourly maintenance marks claims older than fifteen minutes failed with a provider-reconciliation instruction. Subscription/report/automation outboxes retain equivalent unique claims. Reconcile the stored provider ID/idempotency key and actual provider logs before any deliberate resend; do not simply reset all failed rows to pending. There is no automatic historical email replay on adding credentials.

## Maintenance boundaries

Only auth verification tokens expired for over 24 hours and rate-limit counters untouched for over 24 hours are deleted, in bounded batches with expiry rechecked in the mutation. Bookings, payments, refunds, customers, subscriptions, audit history, delivery history and usage history are retained. Elapsed waitlist rows become `EXPIRED`, not deleted. Membership/package validity and subscription usage periods are evaluated by existing date-aware services; no destructive monthly reset is required and no recurring membership charge is introduced.

Waitlist opening notifications remain post-commit best effort through the existing service. An automatic retry/outbox for missed waitlist notifications, live WhatsApp dispatch, provider inquiry/reconciliation, and outbound webhook delivery are not supplied by this dispatcher; their integration states and launch limitations must remain explicit. In particular, do not equate scheduler setup with those providers being available.

## Operational acceptance

1. Review and apply migration 0024 (and following release migrations) to an isolated staging database.
2. Set staging core values, isolated recipient allowlist, scheduler secret and explicit enable switches.
3. Invoke the authenticated route and inspect safe JSON task states and Settings → Integrations.
4. Verify committed booking email outbox recovery, reminder uniqueness, report recipient uniqueness, expired holds, lifecycle expiry and cleanup against fictional records.
5. Invoke twice and concurrently: the same lease/outbox must not execute twice. Simulate an abandoned lease and provider failure; verify recovery/backoff and no unsolicited resend.
6. Verify cron execution in the deployment dashboard and configure alerts for overdue jobs and failed/ambiguous deliveries. No cron dashboard or uptime monitor is claimed configured by local tests.

References: [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## 16 November 2026 deployment compatibility

GitHub's Vercel failure status for preview commit `bd5d035a99e72af0641fe7b964604d5e19a17634` points to `https://vercel.link/3Fpeeb1`, which resolves to the official [Cron usage and pricing](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) page. It states that Hobby permits daily cron and rejects more frequent expressions during deployment. The prior account inspection recorded Hobby in [the environment handoff](STAGING_AND_LIVE_HANDOFF_2026-10-16.md). The five-minute default entry has therefore moved to the opt-in example rather than silently reducing its cadence. No provider plan was upgraded, runtime secret changed, scheduler activated, or failed check overridden. The next deployment check must confirm the configuration repair; this evidence does not establish that the app has deployed successfully.
