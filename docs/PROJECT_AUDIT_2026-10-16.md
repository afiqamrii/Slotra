# Slotra project audit — 16 October 2026

## Decision

**The project cannot be declared 100% complete or production accepted.** Core product code exists across every roadmap phase, but some advertised integrations still lack production implementations, and several deployment/acceptance gates require an isolated staging environment and real provider evidence. This audit repairs concrete code defects; it does not certify every possible runtime, role, dataset or external service.

Audited checkout: `slotra-step15`, branch `codex/step16-saas-billing`, base commit `4310799948af1d8892a27938ebeadfad633d370b`, plus the existing uncommitted implementation and this audit's changes. The separate `C:/Users/afiqa/Slotra` checkout was older and was not edited. Existing unrelated changes were preserved. No deployment, remote migration, real payment, provider email, WhatsApp message or DNS change was performed.

## Phase coverage

| Phase | Code reviewed | Remaining acceptance or implementation |
| --- | --- | --- |
| 1 Foundation | Public/auth/workspace shells, components, navigation, CSS and package tooling; local 390px guest flow and selected owner views at 375/390/430/768/1280px inspected | Broader page/device, keyboard and screen-reader acceptance on staging |
| 2 Auth and tenancy | Better Auth, sessions, effective roles/branch scope, invitations, account delivery | Verified sender/DNS, received-message signup/reset/invite acceptance on staging |
| 3 Venue setup | Wizard, sports, branch/resource administration, hours and prices | Full onboarding/maintenance browser acceptance; lower-tier editing defect repaired here |
| 4 Booking engine | Availability/pricing/quotas, transactions, locks, exclusion constraints and isolated tests | Races using two independent PostgreSQL connections; larger-data query plans |
| 5 Owner operations | Booking list/detail/new/reschedule/lifecycle, calendar, blocks and Available Now; local owner dashboard/calendar/detail, manual receipt, partial/full refund and reschedule verified | Broader role/plan and deployed acceptance; custom-role, branch and stale-quote defects repaired here |
| 6 Public booking | Guest availability/details/review, confirmation tokens and manual booking; a local 390px Starter guest booking was visibly confirmed | Deployed staging acceptance, broader mobile coverage and concurrent stale-slot checks |
| 7 Payments | Manual ledger/refunds, deposits/holds, test and ToyyibPay sandbox boundaries | A venue-owned live merchant adapter, receipts/reconciliation and real gateway acceptance |
| 8 Starter | Customers, operational dashboard, basic reports, CSV, limits and notifications | Deployed acceptance; organization-wide financial/export authorization repaired here |
| 9 Professional | Revenue/utilisation/heatmap/customer analytics, CSV and scheduled-report setup | Sender and runner activation; XLSX/PDF remains follow-up scope |
| 10 Business | Pricing rules, recurrence, memberships/credits/packages, promotions, waitlist, QR, segments and automations | Live WhatsApp adapter/consent/receipts; membership/package sale collection and automatic waitlist retry are absent |
| 11 Pro | Branch permissions/comparisons, audit, corporate credit, scoped API, domain proof, public branch selection and bounded space search/paging; webhook claim/retry foundation | Approved HTTP egress transport and deployed webhook worker, domain serving acceptance and complete audit coverage |
| 12 SaaS lifecycle | Catalog, trials, subscription/grace/change logic, quotas, administration and local simulation | Production recurring-billing adapter, reconciliation, invoice/proration/tax decisions and provider acceptance |
| 13 Launch readiness | Environment/host guards, image storage, jobs, health/monitoring, legal placeholders, CI and smoke tooling | Staging, all migrations, external configuration, job/alert evidence, restore drill, DNS/TLS and legal review |

Code inventory covered `src/app` routes, shared UI, domain services, schema/migrations, test suites, scripts, CI and the product/architecture/security/plan/integration documents. Automated isolated tests provide domain/authorization evidence, not a substitute for independent deployed browser/provider acceptance.

## Repairs in this audit

Follow-up work completed after the first report:

- Refunds use an accessible, amount-specific dialog and native input validation. Manual recording requires acknowledgement that money was returned outside Slotra. Pending/failed provider outcomes no longer masquerade as success; unresolved retries retain their request identity. Receipt defaults follow the current outstanding balance.
- Reschedule saves require the previewed total and booking revision. A changed booking, changed price or newly occupied slot rejects the save and requires another preview. Active online checkouts are rejected consistently; retained online payment snapshots remain protected after refunds.
- Public Pro locations resolve their own sports, prices, hours, date and timezone. Every guest submission/waitlist request revalidates the tenant/branch/resource. Twelve-space pages and literal name search replace the old 100-space cap; long DST days no longer lose starts to a 96-time truncation.
- Webhook claims, lease recovery, receipt fencing, canonical signing and bounded retries are implemented and tested using injected fake transports. No HTTP transport, runtime hook, scheduler activation or production delivery was added.
- Authentication starts a fresh authenticated document after login, and the package/lock Node engine is aligned with the verified Node 24 runtime and CI.

- Customer pages, payment activity and exports no longer leak organization-wide information through selected-branch authorization. CSV requires effective dataset read, export and financial permissions. Basic reports fail closed for branch-restricted users after a downgrade.
- Calendar and booking detail use effective custom permissions. A user can read an authorized booking without being forced to query unauthorized payment history. Action visibility reflects permitted operations.
- Invitation grants cannot exceed the effective permissions/scope of their grantor. Creation, renewal and acceptance recheck the grant, including role/scope changes after issuance. Owner renewal can safely replace an obsolete invitation.
- Verification, reset and private invitation delivery use the configured Resend boundary with strict origin/path/callback validation, HTTPS outside loopback development, token-safe idempotency and staging allowlists. Missing delivery rejects account creation/reset before issuance, including trailing-slash routes. No live email was sent in this audit.
- Private guest confirmation links remain readable after billing expiry/suspension or branch deactivation. They display the booking's actual branch/timezone. New booking acceptance remains separately gated.
- Persistent request limits reset at their fixed window boundary even during denied retries.
- Every plan can maintain existing-branch hours and base prices. Pricing changes require a separate effective permission. Historical booking prices remain unchanged; new branches remain Pro-gated. Closed schedules and in-flight form state are preserved.
- Nested pages retain active navigation. Mobile menu height is bounded and scrollable; organization/branch switching stays reachable without crowding the top bar. Effective server grants control workspace links and Settings cards.
- Booking and space dialogs use native dialogs, Escape handling and focus restoration. Reschedule inputs lock during quote/save operations. Report tabs expose their current selection; empty rates no longer show `—%`, and empty Professional dashboard labels remain readable. Cancellation and completion buttons use the explicit verbs Cancel booking and Complete booking.
- Plan/feature wording distinguishes inclusion from live readiness. Branding points to the image-upload surface. README and account success copy no longer describe old preview/development-only behaviour.
- Readiness checks current schema tables/columns before tenant operations; health refreshes the check and returns 503 for an incomplete schema. Confirmation privacy headers cover shared, booking-host and custom-domain path shapes.
- The disposable harness isolates its build output and uses a local PGlite snapshot through a generated fixture-only driver. Generated fixture content is excluded from production lint/type checks. Test worker concurrency is bounded for WASM database memory use.
- Browser testing exposed a form privacy defect: submitting sign-in before hydration used the native default GET method and placed a synthetic password in the URL. Auth forms now explicitly use POST, and auth/invitation responses receive no-store/no-referrer headers. Seven additional save/detail forms, including the waitlist form containing personal details, now explicitly use POST. No synthetic password, private link or query string is reproduced in this report.
- Image testing exposed a host-routing defect: Next's internal image optimizer omitted the Host header, so the proxy rejected its asset request with HTML. Narrow static-asset matcher exemptions restore image serving while preserving unknown-host denial for application routes. Sixteen regressions use Next's actual matcher behavior to cover this boundary.

## Verification record

The final local checks below include the last source repairs. Partial browser coverage and external acceptance limits are stated separately.

| Check | Result |
| --- | --- |
| Lint | PASS: final-source `npm run lint`, exit 0 |
| TypeScript | PASS: final-source `npm run typecheck`, exit 0 |
| Full automated suite | PASS: final follow-up `npm test`, 35 files / 389 tests, approximately 126 seconds |
| Auth form privacy regressions | PASS: five server-rendered auth form checks, included in the 389-test full suite |
| Proxy/image routing regressions | PASS: 16 actual-Next-matcher and unknown-host regressions |
| Webpack production build | PASS at the earlier checkpoint: `npm run build -- --webpack`, exit 0, compilation + TypeScript + static pages + complete route output; used WASM before compiler repair. The final revision was built with default Turbopack below |
| Default production build | PASS: final follow-up `npm run build` (Turbopack), exit 0; compilation 22.8 seconds, TypeScript 31.1 seconds, 19 static pages generated and complete route output |
| Production dependency advisories | PASS: `npm audit --omit=dev --json` has zero findings after sharp 0.35.5 / source-map-js 1.2.2 updates |
| Full dependency advisories | Five high entries remain in one development-only ESLint → fast-glob → micromatch → braces chain; upstream has no patched braces release |
| Whitespace/diff consistency | PASS: `git diff --check` |
| Patched image runtime | PASS: synthetic 2×2 image encoded and decoded using installed sharp 0.35.5 |
| Disposable fixture driver | PASS: direct PGlite snapshot loads all four synthetic plan organizations without a remote connection |
| Browser visual/keyboard acceptance | PARTIAL PASS: 390px guest/owner workflow, owner detail at 375/430/768px, owner desktop at 1280px and 375×568 confirmation checked without horizontal page overflow; refund and cancellation dialogs exercised. Broader pages/devices and screen-reader acceptance remain open |
| Read-only HTTP route matrix | PASS at the first checkpoint: all 64 semantic checks confirmed. The initial matrix passed 63 and flagged `/admin` because its HTTP status was 200; follow-up verified streamed 404 HTML without platform metrics, confirming denial. The final revision has fresh smoke/browser/domain evidence |
| Read-only smoke | PASS: final sequential `npm run smoke` completed six checks with zero failed and zero skipped. Two cold-route timeouts during concurrent build were followed by a passing warmed-route run after the build |
| Authenticated local workflow | PASS: DOM form method is POST; hydrated owner sign-in reached `/dashboard`. The mobile guest booking appeared in Starter dashboard, Calendar and Booking Detail; a recorded RM25 manual receipt changed paid/due to RM25/RM0 |
| Image HTTP runtime | PASS: direct image returned 200 WebP (196,192 bytes); Next optimizer returned 200 JPEG (156,579 bytes) after the proxy fix |
| Built private-response rules | PASS: build manifest contains all five auth/invitation rules with no-referrer and private/no-store headers |
| Refund/reschedule browser follow-up | PASS: partial/full refund, remaining refundable amount, occupied-time rejection, paid balance preservation, reviewed repricing and final persisted detail |
| Public branch/search/paging follow-up | PASS: 14 spaces reachable, literal name search, branch timezone/price reset and actual second-branch guest confirmation |
| Webhook worker foundation | PASS: canonical signing, claims/leases/fenced receipts, bounded fake-transport retries and negative guards; included in full suite. No HTTP transport/runtime activation |
| External providers/staging/production | Not exercised; no suitable accepted environment/provider evidence supplied |

Environment failures encountered: Windows temporary transform `ENOENT` during overlapping Vitest runs; filesystem `EPERM` during sandboxed build output creation; native SWC loading failure with WASM fallback; and Windows resource error 1450 while overlapping verification processes ran. Obsolete task servers/builds were stopped. A build reached successful Webpack compilation before being stopped during TypeScript to release resources; that attempt was not a completed build pass.

The native compiler failure was diagnosed and repaired: the installed 16.3.8 binary was truncated to 59,546,161 bytes. A clean official exact-version package matched the lockfile SHA-512 integrity and contained the correct 106,191,360-byte binary, which loaded successfully. The installed binary was restored from that verified archive, without changing the Next version. The truncated local file was preserved in the ignored verification folder. A subsequent normal `npm run build` completed successfully with Turbopack and the native compiler. This later build and the working browser session supersede the earlier compiler and browser-blocked narrative; they do not establish staging or production acceptance.

## Browser evidence collected so far

A disposable local Starter venue accepted a guest booking through the mobile browser at 390px width. The visible confirmation showed RM25 total, RM0 paid and RM25 due at the venue. The same booking reference then appeared in the authenticated Starter dashboard, Calendar and Booking Detail. Recording a manual receipt for RM25 updated the visible balance to RM25 paid and RM0 due. These were synthetic local records, with no provider charge or remote database write. Evidence: [mobile guest confirmation](verification/2026-10-16/guest-confirmation-mobile.jpg), [owner mobile dashboard](verification/2026-10-16/owner-starter-mobile.jpg), [mobile navigation](verification/2026-10-16/owner-mobile-navigation.jpg), and [owner desktop dashboard](verification/2026-10-16/owner-starter-desktop.jpg).

The sign-in form's DOM method was verified as POST, and hydrated sign-in reached the owner dashboard. The cancellation dialog opened with focus on its reason field; Escape closed it and restored focus to Cancel booking. Tab did not focus underlying controls during the observed sequence, but a BODY focus sentinel occurred, so this audit does not claim a strict keyboard trap. DOM width measurements showed no horizontal page overflow in the checked owner views at 375/390/430/768/1280px. Additional evidence: [375px booking detail](verification/2026-10-16/owner-booking-375.jpg) and [tablet booking detail](verification/2026-10-16/owner-booking-tablet.jpg).

The earlier browser limitation was resolved during the follow-up with an actively presented local tab. A second disposable fixture provided a paid RM25 booking and an occupied adjacent slot. The browser recorded a RM10 refund (RM15 paid/RM10 due), rejected the occupied 09:00 reschedule, saved a time-only 10:00 move with that balance intact, and recorded the remaining RM15 refund (RM0 paid/RM25 due). After a fresh RM50 quote, a two-hour 10:00–12:00 reschedule saved at RM50 total/RM0 paid/RM50 due. Both succeeded refunds remained in the ledger; no further refund control remained on the fully refunded receipt. Pending controls locked correctly and the receipt default followed the new balance. These were synthetic ledger assertions; no money moved. Evidence: [refund dialog](verification/2026-10-16/refund-dialog-followup.jpg), [occupied-slot rejection](verification/2026-10-16/reschedule-conflict-followup.jpg), [final refund/reschedule result](verification/2026-10-16/refund-reschedule-final-followup.jpg).

Public follow-up checks reached all 14 synthetic spaces over two pages, found Court 14 by search, changed to the Second Venue with Asia/Tokyo local times and RM45 pricing, and confirmed a guest booking at that branch with RM0 paid/RM45 due. The checked 390px flow and 375×568 confirmation had no horizontal page overflow; browser error logs were empty. Evidence: [mobile pagination](verification/2026-10-16/public-pagination-mobile-followup.jpg), [branch selector](verification/2026-10-16/public-branch-mobile-followup.jpg), [second-branch confirmation](verification/2026-10-16/public-second-branch-confirmation-followup.jpg). Temporary viewport overrides were reset. Stale-slot independent-connection races, every role/plan workflow, screen-reader acceptance and deployed provider behavior remain separate from the completed local checks.

Dependency evidence: [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), and [unpatched braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The braces package registry still reports 3.0.3. npm proposes a breaking Next ESLint downgrade; it was not forced. Keep untrusted glob patterns out of tooling and review the development dependency advisory before release. The production-only audit is separate from this unresolved tooling finding.

## Required work before release

1. Use a separate staging database/project and approved synthetic accounts. Inspect/apply every committed migration with the guarded migration procedure. This audit did not verify the remote migration journal; older docs reporting main through 0023 are historical, while current code includes 0024–0025.
2. Complete owner/staff/custom-role/branch acceptance, occupied/stale slots, refunds/rescheduling, lifecycle and quota recovery, all four plan tiers, expiry/replay and keyboard/accessibility checks. Reproduce the locally verified guest → owner calendar/detail → manual receipt flow on staging. Broaden the selected 375/390/430/768/1280px observations to all critical pages and short-height devices.
3. Verify receipt of account/booking/subscription/report mail with a verified sender and staging recipient restrictions. Observe protected jobs, retries, monitoring ingestion and alert receipt. Credentials alone are not acceptance.
4. Select/implement the live venue merchant and Slotra subscription adapters. Keep unavailable collection options visibly disabled until accepted. Simulator activation never means money moved.
5. Implement/accept remaining optional Pro/Business integrations before marketing them as live: approved HTTP egress and deployed outbound webhook delivery, official WhatsApp consent/delivery and actual custom-domain provisioning. Public branch selection and bounded space pagination are now implemented and locally verified; repeat those checks on staging.
6. Agree backup/recovery objectives, verify retention and perform a restore drill. Review Terms/Privacy/Acceptable Use and support details. Verify DNS/TLS/host routing, effective deployed privacy/security headers, clean CI, rollback and post-release monitoring.

The authoritative launch gate remains `RELEASE_CHECKLIST.md` together with `INTEGRATION_READINESS.md`. A manual-payment pilot may defer optional online integrations only when its allowed capabilities and outstanding gates are explicitly accepted.

The exact owner inputs, supported secret/config names, verified access limitations and ordered release procedures are in [STAGING_AND_LIVE_HANDOFF_2026-10-16.md](STAGING_AND_LIVE_HANDOFF_2026-10-16.md). No working local Docker daemon was available for independent PostgreSQL tests.

## Changed-file inventory for this audit

This is a session-specific inventory, not the entire pre-existing dirty Git diff.

- Tooling: `package.json`, `package-lock.json`, `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `vitest.config.mts`, `scripts/e2e-server.mjs`.
- Documentation: `README.md`, `docs/PROJECT_AUDIT_2026-10-16.md`, `ROADMAP.md`, `PRODUCT_SPEC.md`, `NOTIFICATIONS.md`, `INTEGRATION_READINESS.md`, `RELEASE_CHECKLIST.md`, `SECURITY.md`, `DATABASE.md`, `DESIGN_SYSTEM.md`.
- Browser evidence: screenshots under `docs/verification/2026-10-16/`, containing synthetic local data only.
- Workspace routes: `src/app/(workspace)/{layout.tsx,layout.test.ts,dashboard/page.tsx,reports/page.tsx,calendar/page.tsx,customers/page.tsx,payments/page.tsx,bookings/[id]/page.tsx,team/page.tsx,settings/page.tsx,settings/branch/page.tsx,settings/plan/page.tsx}`.
- Entry/actions/endpoints: `src/app/page.tsx`, `src/app/actions/team.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/api/exports/[dataset]/route.ts`, `src/app/api/health/route.ts`, `src/app/book/[organizationSlug]/public-booking-flow.tsx`, `src/app/globals.css`, `src/proxy.ts`.
- UI: `src/components/{navigation-links,mobile-navigation,top-bar,app-sidebar,current-plan-badge,modal-dialog,booking-detail-actions,booking-quick-form,resource-block-form,venue-management,reschedule-form,pro-settings-forms,professional-insights,professional-dashboard,pro-dashboard,auth-page,branch-create-form,venue-migration-notice}.tsx`.
- Services: `src/lib/{account-email,dev-mail,email-templates,authorization,organization-service,rate-limit,public-booking,payment-activity,venue-schema,venue-service,plan-catalog}.ts`.
- Domain/route regressions: `src/lib/{account-email,team-actions,auth-route,auth-form,auth-tenancy,proxy-routing,public-booking,payment-service,organization-page-access,workspace-route-permissions,venue-schema,venue-service,branch-settings}.test.ts`.

No schema or migration file was edited in this audit. Existing migrations and pre-existing implementation changes remain present. Generated fixture data, credentials and build artifacts belong only under ignored verification/build directories.

Follow-up additions to the inventory: `src/components/{booking-payment-section,reschedule-form,auth-page}.tsx`, `src/app/actions/{bookings,payments,public-booking}.ts`, `src/lib/{booking-service,payment-service,public-booking,pro-webhooks,webhook-worker}.ts`, `src/lib/{booking-service,payment-service,public-booking,pro-access-service,booking-finance-actions,webhook-worker}.test.ts`, `docs/{BOOKING_ENGINE,MULTI_BRANCH,PAYMENTS,WEBHOOKS,STAGING_AND_LIVE_HANDOFF_2026-10-16}.md`, the public route/flow/CSS, fixture script, Node engine metadata and verification screenshots. The earlier six-image count refers to the first checkpoint; follow-up screenshots are separately named above.
