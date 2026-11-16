# Release checklist

For each row record **READY**, **NEEDS CONFIGURATION** or **BLOCKED**, with environment, revision, date and evidence. READY means that particular release check passed, not that a provider is generally available. Do not mark external integrations READY from code or credentials alone. Current status is conservative until staging acceptance; see [INTEGRATION_READINESS.md](INTEGRATION_READINESS.md).

| Area | Status | Acceptance required |
| --- | --- | --- |
| PRODUCT | NEEDS CONFIGURATION | Core guest/staff flows, owner calendar, manual totals, empty/error/loading states and 375/390/430px/tablet/desktop checks on staging. No fake bookings or provider success. |
| DATABASE | NEEDS CONFIGURATION | SQL inspected; exact target approved; new migrations applied development → staging; journal, private grants, tenant constraints and independent PostgreSQL races checked. |
| SECURITY | NEEDS CONFIGURATION | Tenant/branch/role IDOR tests, key hashing/scopes/revocation, safe logs, trusted ingress, effective response headers and abuse limits accepted on deployed staging. |
| AUTH | NEEDS CONFIGURATION | Guarded auth/invitation delivery is implemented; verified sender, received verification/reset/invitation messages, sign-in/out/reset/session protections, token expiry/replay and invitation ownership still require staging acceptance. |
| EMAIL | NEEDS CONFIGURATION | Verified Resend sender, exact DNS, monitored reply-to, restricted staging key/allowlist, authorized self-test and actual received email/header/template checks. Missing/failing delivery never rolls back booking or becomes SENT. |
| BOOKING PAYMENTS | BLOCKED for live gateway | Venue-owned live merchant adapter, valid signatures/amounts, duplicate/late event handling, expiry, reconciliation and supported refunds accepted. Starter manual/pay-at-venue remains the safe scope. |
| SAAS BILLING | BLOCKED for live collection | Separate Slotra merchant/provider, recurring collection and lifecycle webhooks accepted. Production clearly says configuration incomplete; development simulator cannot operate there. |
| WHATSAPP | BLOCKED for live delivery | Official adapter, sender/templates, stored purpose-specific opt-in/opt-out and receipt/retry acceptance; no unofficial browser automation. |
| DOMAINS | NEEDS CONFIGURATION | Register/confirm ownership of `slotra.my`; attach `slotra.my`, `app.slotra.my` and `book.slotra.my` to Vercel; install provider-issued DNS; verify HTTPS and host routing. Customer TXT ownership plus deployment/TLS activation checked; unknown hosts fail safely. |
| STORAGE | NEEDS CONFIGURATION | Private bucket/credentials and staging isolation verified; image MIME/extension/size/decode limits, tenant path ownership, published readback and negative upload checks. |
| JOBS | NEEDS CONFIGURATION | Migration, secret, approved cadence/runtime, first observed runs, lease/replay/backoff/interruption checks and stale-job alert; no duplicate legacy schedules. |
| BACKUPS | NEEDS CONFIGURATION | Actual retention/fresh recovery point, off-site/object protection, accountable operator, agreed recovery objectives and successful staging restore drill. |
| MONITORING | NEEDS CONFIGURATION | Safe server/client/route/provider/job event ingestion and alert receipt, health uptime check, redaction/retention reviewed. |
| LEGAL | NEEDS CONFIGURATION | Terms/Privacy/Acceptable Use reviewed; central support configured; venue supplies cancellation/refund/rules text where applicable; no unsupported compliance guarantee. |
| STAGING | NEEDS CONFIGURATION | Separate verified database/project, preview protection, environment-specific credentials, no production delivery/merchant effects, synthetic seed and full smoke acceptance. |
| PRODUCTION | BLOCKED | Prior gates accepted; explicit production configuration/provider mode/migration authorization; compatible build, rollback plan and post-release monitoring. |

## Verification record

- [ ] `npm ci` succeeds from the lockfile in clean CI.
- [ ] `npm run lint`.
- [ ] `npm run typecheck`.
- [ ] `npm test` (unit and isolated domain/integration tests).
- [ ] `npm run build` (production build in clean CI; Webpack remains an optional diagnostic alternative).
- [ ] `npm run smoke` against deliberately configured staging, with `SMOKE_VENUE_SLUG` set; no skipped required check.
- [ ] Critical guest create → confirmation → owner calendar E2E, occupied/stale slot, auth access/reset and mobile flows accepted.
- [ ] Two independent PostgreSQL connections verify reservation/corporate/financial concurrency on isolated staging.
- [ ] Configured and absent provider paths, failure resilience, duplicate webhook and replay-safe jobs accepted.
- [ ] Production has `NEXT_PUBLIC_PRODUCT_DOMAIN=slotra.my` and `BETTER_AUTH_URL=https://app.slotra.my`; any explicit first-party origins match the derived URLs.
- [ ] Canonical metadata resolves to `https://slotra.my` for marketing and `https://book.slotra.my/{slug}` for public venues; workspace routes are not indexed.
- [ ] Safe browser/server log inspection; no raw secrets, personal payloads or confirmation links recorded.
- [ ] Branch protection requires CI; ordinary PR CI has no production secrets/migrations.

## Email content checks

- [ ] Venue booking confirmation shows name, space, local time, public reference, total, paid and due/outstanding; Starter says Payment due at venue.
- [ ] Reschedule and cancellation copy matches the booking and does not imply an automatic refund.
- [ ] Trial ending, subscription started/payment failed, upgraded/downgraded, cancellation scheduled and scheduled-report templates render correctly in received mobile/desktop mail.
- [ ] A provider accepted ID is distinguished from inbox receipt; failed/ambiguous delivery has an operator reconciliation procedure.

## Release decision

Record allowed pilot capabilities explicitly. Manual-only pilots may defer online gateway, automatic SaaS collection, WhatsApp, outbound webhook delivery and customer custom domains only while those functions remain visibly unavailable. A missing optional provider must not crash unrelated operations. Production deployment is not authorized merely by completing code changes or merging a PR.
