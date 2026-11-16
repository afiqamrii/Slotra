# Design system

## Interactive booking venue view

Guest booking and staff booking creation offer 3D and Flat views of the same real, authorized spaces. The 3D arrangement is explicitly illustrative, not a measured floor plan. Badminton spaces have court markings and nets; other sports use neutral spaces. No players, occupancy, maintenance state or venue geometry is invented.

Guest 3D availability and prices belong to one explicit venue-local start time and the selected duration. Selecting a space shows its server-provided status before continuing to the existing details/review flow. Flat keeps the full time grid, including eligible waitlist choices. Staff space selection is neutral until its available times are checked. Changing views never submits a booking or creates a reservation.

HTML space controls, text status, keyboard camera buttons and a flat fallback accompany the canvas. Rendering is demand-driven, with bounded pixel ratio and at most twelve spaces per scene; larger staff lists have explicit pagination. The Three.js chunk loads on the client, and scene resources are disposed when switching views or leaving the page.

## 16 November 2026 booking interaction improvements

Bookings uses one calm management surface with visible branch/timezone context, primary search/date/branch controls, and removable chips for active filters. Clearing filters and changing views preserve the current branch; view changes reset conflicting date/status and pagination while retaining compatible search. A new search can span history; selecting a view keeps that search within the selected view. Malformed URL fields recover safely, and stale space/sport choices do not silently hide a different branch's bookings.

Desktop rows and mobile cards show explicit unpaid, paid-in-full or no-payment labels beside the booking total. Cancelled and expired rows omit collection labels. The label is a view of stored totals and net paid, never an instruction that money moved or a refund occurred. Booking creation controls follow effective permissions.

Guest availability offers venue-local time-of-day and Available only filters, counts scoped to the displayed spaces, and a clear-filter action when nothing matches. Full times remain visible by default for waitlist discovery. Loading, unavailable and retry states are distinct. Stage changes move focus to the relevant heading; waitlist entry repeats the selected space/date/time. Submission controls lock through saving and successful navigation, and eligible payment selection stays consistent with the visible options.

Staff customer search distinguishes searching, no match and a failed request with Retry search. Changing the customer or booking choices clears dependent time/package/credit selections before reloading them. Save failures describe uncertainty honestly; a successful save keeps the form locked while opening the booking. These conventions require final integrated browser/keyboard acceptance recorded in `UX_AND_BOOKING_REVIEW_2026-11-16.md`.

## 16 October 2026 interaction corrections

Workspace links and Settings cards reflect effective custom permissions and branch scope. Nested routes retain the parent highlight. Mobile navigation scrolls within the viewport and contains venue/branch switching; the top bar shows compact venue identity. Restricted staff are not offered All branches. The plan badge opens Plan & Usage.

Booking/space dialogs use native modal focus containment, Escape and focus restoration. Reschedule inputs lock during quote/save. Existing-branch hours/pricing maintenance is available on all plans; separate price permission controls price fields. Integration copy distinguishes entitlement, planned implementation and configured delivery. Final visual/keyboard/viewport acceptance remains explicit in `PROJECT_AUDIT_2026-10-16.md`.

## Step 18 integration readiness patterns

Settings → Integrations uses a concise service list with provider, explicit status label, plain-language next step and one relevant settings link. Distinguish platform infrastructure from venue-owned merchant/domain configuration. Color reinforces text; it must not be the only status signal. Present Not configured, Check configuration and Needs verification honestly. The presence of a key never produces a fake Connected label or success receipt.

Email self-test targets the signed-in authorized user's address and says provider acceptance rather than inbox delivery. Storage shows a clear unconfigured state and a simple logo/cover form only when available, with file limits beside the control. Private storage remains an implementation detail except where users need to understand what branding will be public. Keep unavailable provider actions absent or explicitly disabled, never styled as a working connection.

Venue policy inputs collect the owner's own cancellation/refund/rules text. Public booking renders that text without drafting terms on the venue's behalf. Platform legal pages visibly require review and link from registration/footer. Integrations, images and policy sections stack on mobile within the existing settings layout; no new dashboard navigation or product wizard is introduced.

## Subscription and platform administration patterns

Keep Billing and plan comparisons inside the authenticated workspace. Show current plan/status, renewal and monthly allowance in two calm panels, stacking on mobile. Professional uses the restrained green Most Popular treatment; annual selection clearly states the yearly price and two months free. Group plan features by owner outcome, not raw internal feature names. Use explicit trial/grace/paused notices and honest development/no-provider labels.

Cancellation is progressively disclosed with confirmation; downgrade shows excess resources/branches/staff and explains retained records. Checkout read alone is never described as paid. A separate platform navigation distinguishes Super Admin from venue management. Sensitive admin forms require reason and typed venue slug; UTC expiry labels avoid ambiguous support dates. Tables have bounded history and mobile overflow, not giant configuration screens.

Step 16 isolated visual checks covered plan selection at 375, 390, 430, 768 and 1280px, plus mobile billing and admin detail. Cards align, stack and retain readable actions without page overflow. This acceptance does not claim earlier Grow/Pro screens have all been reverified.


**Status:** Foundation, venue onboarding, staff booking, Starter operations, Professional reporting, Business Grow, and Pro administration patterns are implemented in code; authenticated desktop/mobile visual acceptance remains pending.

## Pro administration pattern

Keep All Branches versus a specific branch in the workspace shell; never represent a branch as a new tenant. Use a concise branch comparison table with meaningful money/time labels, no invented “profit,” and cards only for the few executive metrics owners need first. Scheduled-report setup shows one branch choice; All Branches offers an executive Overview and does not silently replace an older branch-specific schedule. Advanced permissions are grouped by work domain and explain the role’s effective access; the branch assignment is a separate, explicit choice. Show API secrets only once. Domain cards distinguish “TXT proof found” from “website active.” Webhook cards distinguish “event queued” from “delivered.” Corporate limits show used/remaining in currency and never imply an invoice or payment was issued. On small screens, cards stack and tables may scroll, while common booking actions remain prominent.

## Step 14 Grow pattern

Keep Business capabilities in the existing Grow section instead of scattering controls through daily booking screens. Start with an outcome-focused card and one primary action, then reveal the short template-first form: peak/quiet pricing, weekly recurrence, discount or credit membership, hours package, promotion, reminder, or inactive-customer tag. Present familiar venue words—Price, Membership, Package, Promotion, Waitlist, Check-in—not internal table names. A form should disclose applicability, dates, and limits only when relevant; a template may prefill values but must not silently enable a paid or external action.

Show a recurrence preview with available/unavailable counts before creation, and report any partial results by date. Staff credit choice should show minutes before/after; promotions should show validation feedback without leaking internal errors. Waitlist copy must say the time is **not reserved**. QR check-in should resolve to a human-readable booking and use the existing legal Check In action. Automation cards must distinguish configured email, development preview, failed delivery, and no provider; a simulated WhatsApp result is never styled as a real message to a customer. Business analytics use compact operational cards with explicit “Not tracked” for membership revenue and package sales rather than invented numbers. Mobile Grow forms stack to one column; no dense rule editor or node-based workflow canvas is introduced.

## Professional insight pattern

Keep Professional’s dashboard concise: four revenue cards, two explanation-rich operational panels, and a small row for customers, peak time, and plan usage. The report page uses full workspace width but only five tabs (Overview, Revenue, Bookings, Courts & spaces, Customers). A compact filter bar controls one date period plus optional sport, space, and status. Charts use restrained teal for booked value and a lighter paired shade for collected; labels/tooltips state actual values. Heatmap cells include counts and accessible text so color is not the sole signal. Zero-denominator rates show “—”, not a misleading 0%. On mobile, metric cards reduce to two columns, report panels stack, and the heatmap scrolls horizontally. Scheduled-report setup has one short form and a prominent missing-email configuration notice; never style a preview as delivered.

## Philosophy

The interface should feel premium, calm, professional, and easy for a non-technical venue owner to scan. Common information comes first; advanced controls will use progressive disclosure when those workflows exist. The owner workspace and public booking experience intentionally have different visual treatments.

## Brand and typography

The product name comes from `src/lib/brand.ts` and can be changed with `NEXT_PUBLIC_PRODUCT_NAME`. The production domain (`slotra.my`) is configured independently through the centralized URL resolver and must not be copied into component text. The single accent is the `--brand` CSS custom property, initialized from the validated `NEXT_PUBLIC_BRAND_ACCENT` hex value; its default is `#176b5b`. Check contrast before changing it. The parent company is Nexura Labs.

Typography uses the local system stack: Aptos, Segoe UI, then platform sans-serif. Headings use tight letter spacing and a clear size step; supporting text is smaller and muted, with readable contrast on light surfaces. No external font download is required.

The current logo is a typography-led wordmark using the configurable product name. It uses a compact weight and spacing without a separate symbol. The browser icon shows the first letter of the configured name on the brand accent. The final product name and identity remain undecided.

## Colour, surfaces, and spacing

- The workspace uses a soft neutral canvas (`#f7f8f6`), white surfaces, dark ink (`#1b2d29`), and muted secondary text.
- The accent is reserved for primary actions, active navigation, links, focus, and a few informative highlights.
- Statuses use restrained green, blue, amber, and neutral fills plus explicit text; colour alone does not convey meaning.
- Layout spacing is generous at section level and compact within data rows. Shared spacing is applied through component classes in `src/app/globals.css`; a numeric spacing scale is not yet formalized.
- Controls use an 8px radius, common panels about 12px, and occasional feature surfaces up to 16px. Borders are subtle; shadows are soft and used sparingly.
- Avoid gradients, glassmorphism, decorative clutter, large shadows, and unnecessary nested panels.

## Current component conventions

`BrandLogo`, `AppSidebar`, `TopBar`, `NavigationLinks`, `PageHeader`, `SectionHeader`, `StatCard`, `StatusBadge`, and `EmptyState` are small reusable presentation components. Icons come from `lucide-react` and normally use a 1.6–1.8 stroke. Business rules must stay outside these components.

Navigation links and staff booking creation/search are live. The public booking flow, authentication, workspace setup, and team invitations are live. The dashboard shows stored venue setup, never fake bookings.

## Responsive rules

- The desktop workspace has a 252px left sidebar and a top bar. At 980px and below, the sidebar becomes a keyboard-accessible mobile navigation menu that closes on route changes, focus leaving the menu, or Escape. Escape returns focus to the menu toggle.
- At 700px and below, the top bar and page headers simplify; the dashboard stacks side panels. At 480px and below, cards, timeline rows, and spacing tighten without horizontal page scrolling.
- The public booking flow is mobile-first: sport/date/duration precede a time-first list with large labeled space/price buttons. At 700px and below it switches from a desktop multi-space table to readable time-group cards rather than squeezing the table.
- Landing value cards and pricing cards collapse progressively. Verify 375px, 390px, 430px, tablet, and desktop widths when editing shared layouts.

## Clarity and readability

- The landing visual is illustrative. Primary links lead to workspace sign-in or venue registration; the owner sidebar links to the active venue public booking page only after setup.
- Pricing uses five representative feature lines per plan, progressive inclusion, and one recommended plan.
- Operational names and pricing features use 14px text; supporting dashboard details and status labels use at least 12px. Form inputs use 16px.
- Show the booking action once per viewport: in the desktop top bar or the mobile page header.
- Mobile schedules omit decorative avatars to give names and statuses more room. Public booking uses a compact venue header so live times appear sooner.

## Accessibility baseline

Use semantic links and buttons, labeled inputs, visible focus states, readable contrast, and text labels on statuses. Unavailable slots are disabled with explicit Full/Unavailable labels, not color alone. Reduced-motion preferences disable nonessential transitions. Keyboard and screen-reader acceptance should be repeated with a dedicated browser test.

## Still pending

A formal token scale, final font choice, final brand colour, production component inventory, charts, and interactions for future features remain undecided. Do not infer those designs from the current visual placeholders.



## Public availability presentation

The live desktop grid compares multiple spaces for each time; the mobile view groups tappable spaces under each time. Full and Unavailable are written on disabled cells. Server-supplied prices appear only on selectable cells, and a compact selection reminder precedes guest details; the full summary follows the form on mobile and sits alongside it on desktop. A short three-part progress indicator, seven-day strip, native date input, and 1/1½/2-hour choices reduce form work. Guest name/phone/email persist when the date or slot changes. The review shows the server-supplied amount due and labels Pay at venue or the development-only test checkout. No live online-payment success is implied.

## Authentication preview

Sign-in and registration share a split layout: a decorative sports image on the left and the form on the right. Below 800px the image is hidden to prioritize the form. The image is generated editorial artwork, not a photograph of a customer venue or a testimonial. The locally stored WebP is displayed using Next Image. A restrained dark image overlay ensures readable white text. Registration uses a short Account → Verify email → Business progress guide. Password fields have visibility controls, confirmation, and live 12-character guidance. The final business step asks only for name and a suggested, editable workspace address. Invited teammates join the existing organization instead of creating a business.

## Venue onboarding pattern

The ten sections show one primary question at a time with a compact step count and progress bar, Back/Continue controls, defaults, and a locally saved draft. The business-address checkbox keeps first-branch entry short. A single weekly schedule is the default and expands to per-day editing; midnight is expressed with an explicit Next day choice. Advanced maximum duration is collapsed. Sport selection drives contextual Court/Pitch/Lane/Table/Simulator/Space labels while database records remain resources. Inline errors and a slug-availability check precede Finish. The mobile layout collapses fields and sport choices to one column; management uses a single dialog rather than nested settings.

The branding step deliberately states that logo uploads are unavailable; it does not simulate production storage. The booking URL now opens the active guest flow for configured venues. The dashboard checklist reflects stored setup, never sample bookings.

## Reception-first booking UI

The Bookings page opens on Today, with compact Today/Upcoming/Past/Cancelled/All tabs. Search, date, and branch are primary controls; sport, space, status, and source live under More filters. A search without a date moves to All results so staff can find historical references or phone numbers. Desktop uses a dense, readable table; narrow screens use linked cards rather than a squeezed table. Empty and conflict states use plain language, never raw database errors.

Manual and walk-in entry is choice-led: sport and space buttons, Today/Tomorrow shortcuts, quick duration buttons, visible server-supplied time choices grouped by period, then existing/new/guest customer choice. Optional notes are collapsed. The summary is sticky on desktop and follows the steps on mobile. Walk-in begins from Available Now and preselects a space; staff can still change it. A price is not invented before save. Detail actions are shown only for legal domain transitions, with explicit confirmation for cancellation/no-show and a refund limitation when a paid booking is cancelled. Reschedule shows a server-calculated price comparison before save. Day timeline is horizontally scrollable on desktop, while mobile retains readable resource rows and uses a compact week overview rather than forcing a miniature grid.

## Phase 6 public states and branding

The public page has only venue identity and Contact navigation. Logo URLs are rendered only when HTTPS; otherwise initials are used. Venue hex color is applied only if white text has at least 4.5:1 contrast, falling back to the platform green. Arbitrary CSS is not accepted. Skeletons keep the availability panel stable while requests run. Closed dates, no spaces, no slots, conflicts, stale prices, and temporarily unavailable service have plain-language states. Confirmation shows the reference, venue, sport/space, local time, name, amount, and Pay at venue state; it offers copy-reference, contact, and book-again actions. A reference-only public lookup is deliberately absent.



## Payment UI pattern

Settings → Payments presents four large radio-card policies; only supported online options are selectable after a venue-owned provider connects. Fixed/percentage inputs appear contextually, and hold length stays under a collapsed advanced control. A separate card explains whether TestProvider is connected and explicitly says no real money moves. Booking detail places a concise Total/Paid/Outstanding strip before payment history and authorized manual receipt/refund controls. Staff must confirm a refund record; cancellation copy explicitly says it does not return money. Guest confirmation uses distinct pending, paid-in-full, deposit-with-balance, pay-at-venue, and expired language. The simulator is enclosed in a clearly labeled development panel, not styled as live checkout. Mobile policy cards, balance tiles, payment activity, and simulator buttons stack rather than squeezing into a table.

Starter payment settings use two equal-height plan cards: a neutral current-plan summary and a restrained green Professional highlight with a small lightning icon. The comparison action stays inside the authenticated workspace at Settings → Plans, rather than sending owners to public marketing. Plan preview copy comes from one presentation catalog shared with landing pricing; payment permissions remain in the separate entitlement model. A compact current-plan badge sits beneath the Slotra logo in the desktop sidebar and inside the mobile navigation panel, linked to Plans; it does not crowd the top bar. The Professional comparison card has a clearly labelled owner-only **sandbox test** action when configured; it requests only a contact number and states that no real money or automatic renewal is involved. Business and Pro purchase remain previews even while gated feature code exists. Never style this test as a live subscription purchase or connected venue gateway.

## Starter operational views

The dashboard uses compact real-data metric cards, a two-column schedule/court-status area, a monthly usage meter, and one context-specific warning only after usage reaches 70%. At mobile widths, columns stack; schedule and status remain readable without a horizontal desktop table. Reports intentionally use the full workspace width: period tabs, four concise totals, one large activity chart, and small outcome/export sections. Bar, Trend, and Data are alternate views of the same server-calculated daily/monthly series, not separate analytics products. The customer metric is explicitly “New customers,” meaning records created in the selected period. Professional upsell appears as one restrained preview at the bottom, never as a fake purchase button.



## Reception workspace refinements (November 2026)

Every plan starts with the same operational layer: four readable day metrics, a current/next session list, a front-desk checklist and refresh. Financial analysis follows only when authorized. Date and timezone context remain beside the numbers. Empty states explain what will appear and offer a permitted next action.

Customer directories use explicit group tabs, labelled search/sort controls, stable pagination and linked rows that become compact cards on mobile. Profiles put identity and a prefilled booking action first, then activity, contact information, permission-gated balances and history. Editing contact details and internal notes is progressively disclosed, locks during save, announces success and reports revision conflicts without overwriting another user's changes.

Calendar offers Timeline, Week and Agenda views with shared branch/date navigation. Overnight sessions show their date context. Time position follows real elapsed time across daylight-saving changes. Truncated schedules disclose the limit. Available Now exposes search, status filters, result counts and manual refresh without implying a continuous live connection.

Payments separates Activity, Outstanding and Refunds. Amounts always retain their currency; collectible-balance summaries explain their scope and do not change silently when searching. Simulation labels stay visible. Mobile rows preserve the reference, customer, space, time, amount and status without a squeezed desktop table.

Quick find opens with Ctrl/Cmd+K or its labelled header button. It uses the shared modal's focus management, a labelled combobox, arrow/Enter selection, Escape dismissal and permission-filtered destinations. Mobile keeps an accessible icon trigger. Confirmation calendar downloads are static copies, and confirmation icons reflect pending, confirmed or closed states.
