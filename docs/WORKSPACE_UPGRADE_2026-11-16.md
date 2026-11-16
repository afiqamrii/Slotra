# Workspace upgrade — 16 November 2026

This extends the [booking review](UX_AND_BOOKING_REVIEW_2026-11-16.md) with implemented customer, reception, calendar, payment and navigation improvements. Existing changes in this checkout were preserved. This is local implementation and verification, not deployment acceptance.

## Implemented experience

- **Daily operations on every plan:** scheduled bookings, active sessions, upcoming arrivals, check-in/completion attention, a current/next session list, payment-hold counts, and front-desk shortcuts. Operational access is independent of financial-report access. Counts cover the complete local day, including overnight sessions; the next-session list is intentionally bounded.
- **Customer directory and profiles:** name/phone/email search, returning/upcoming/no-booking groups, sorting and genuine pagination; contact details, internal notes, booking history and permission-gated per-currency balances. Contact edits use a revision check and audit records. Creating a booking from a profile selects that exact authorized customer.
- **Calendar and available spaces:** Timeline, Week and Agenda views, date and branch controls, blocked-time reasons, readable mobile layouts, honest truncation notices, DST-aware positioning, and overnight sessions appearing on every day they overlap. Available Now has search/status filters, visible result counts and refresh; inactive branches are closed. Availability queries support resource batches larger than 100.
- **Payments workspace:** separate Activity, Outstanding and Refunds views; reference/customer/phone search, status filters and pagination. Collectible balances exclude cancelled and expired/held bookings and remain separated by currency. Activity preserves original transaction amounts; simulated refunds are explicitly labelled.
- **Quick find:** Ctrl/Cmd+K, keyboard selection, permission-filtered pages, branch-aware booking shortcuts and an encoded booking search. The dialog restores focus and does not persist search text.
- **Private calendar download:** eligible confirmed booking confirmations offer a portable `.ics` file. UTC event times, UTF-8 line folding and escaped content preserve calendar compatibility. Download access uses the same private confirmation token and venue slug; event contents exclude private tokens, customer contacts and payment information. The copy is static and does not silently claim automatic rescheduling.
- **Recovery and visual consistency:** usable workspace retry/not-found screens, clearer confirmation state icons, responsive cards, consistent spacing and reduced duplicate primary actions.

## Important boundaries

Customer profiles require organization-wide customer access; a selected-branch role cannot inspect tenant-wide customer histories. Booking and financial fields have separate permission checks. Payment views, calendar data and operational dashboards retain organization and branch authorization on the server. UI visibility is an additional convenience, not the security boundary.

No database migration or new dependency was needed for this upgrade. No production database, external messaging or live payment provider was used. Existing release gates still apply: independent-connection PostgreSQL race acceptance, provider onboarding and production delivery verification. Refunds follow the existing net-paid ledger policy; waiving a charge requires a separate financial policy.

## Verification

Automated verification:

- The complete test run executed 440 tests: 439 passed and one calendar route test exposed a stale mock missing the new end-of-day field. The mock now matches the service contract and assertions check actual forbidden action labels/hrefs. The corrected permission suite passes all 8 cases, including a new positive custom-grant case.
- The final focused run passes 40 tests across the corrected permission suite, 30 new calendar-file/route/host tests and 2 customer URL-filter cases.
- The customer database suite passes 11 cases after two additional permission regressions: custom roles without booking-view access receive no booking counts from either preselection or customer search. The full run had already passed its original 9 cases.
- Together, these runs verify 475 distinct current tests across 46 files. This is a full run plus focused correction/addition runs, not a claim that the initial full command exited successfully.
- Repository lint and TypeScript checks passed; final changed-file lint passed. The final production build (`npm run build -- --webpack`) passed after all audit refinements, including TypeScript and static-route generation. `git diff --check` is clean.

Browser verification on disposable local PGlite fixtures:

- Quick find: Ctrl+K, text filtering, Enter navigation, arrow selection, Escape dismissal and focus restoration.
- Customer directory Returning group; profile history and balances; internal-note save with confirmed server refresh; exact customer preselection; successful staff reservation. Dashboard then showed the new session, arrival count and outstanding balance.
- Payments: independent RM50 outstanding summary, search narrowing to one booking, clear filters, original RM25 receipt in Activity, and honest empty Refunds state.
- Calendar: timeline links, Agenda date navigation and two tomorrow reservations, Week grouping and phone layouts. Available Now search/status empty state, reset and explicit refresh.
- Guest booking completed at pay-at-venue; calendar download succeeded. The actual downloaded file has the expected 15:00–16:00 UTC range, maximum 75-byte physical lines, and no guest name, phone, email or confirmation link.
- No browser console errors were captured in the staff or guest test tabs. Temporary viewports were reset and the isolated preview was stopped after verification.
- Dashboard, Payments and calendar phone/tablet/desktop layouts were inspected. Payments, Week and customer profiles were measured at 375/430/768/1280px without document overflow; dashboard and guest confirmation were inspected at 390px.

Fixtures cannot establish production PostgreSQL locking behavior. No real payments or external messages were sent.

Screenshots: [dashboard](verification/2026-11-16/dashboard-operations-desktop.png), [payment balances](verification/2026-11-16/payments-outstanding-desktop.png), [calendar agenda](verification/2026-11-16/calendar-agenda-desktop.png), [mobile agenda](verification/2026-11-16/calendar-agenda-mobile.png), [customer note save](verification/2026-11-16/customer-note-saved.png), [mobile customer profile](verification/2026-11-16/customer-profile-mobile.png), [quick find](verification/2026-11-16/quick-find.png), [mobile guest calendar action](verification/2026-11-16/guest-calendar-confirmation-mobile.png).
