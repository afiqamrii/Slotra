# Design system

**Status:** Foundation, venue onboarding, staff booking, Starter operations, and Professional business-report patterns implemented. Step 14 Grow patterns are being added; authenticated desktop/mobile visual acceptance remains pending.

## Step 14 Grow pattern

Keep Business capabilities in the existing Grow section instead of scattering controls through daily booking screens. Start with an outcome-focused card and one primary action, then reveal the short template-first form: peak/quiet pricing, weekly recurrence, discount or credit membership, hours package, promotion, reminder, or inactive-customer tag. Present familiar venue words—Price, Membership, Package, Promotion, Waitlist, Check-in—not internal table names. A form should disclose applicability, dates, and limits only when relevant; a template may prefill values but must not silently enable a paid or external action.

Show a recurrence preview with available/unavailable counts before creation, and report any partial results by date. Staff credit choice should show minutes before/after; promotions should show validation feedback without leaking internal errors. Waitlist copy must say the time is **not reserved**. QR check-in should resolve to a human-readable booking and use the existing legal Check In action. Automation cards must distinguish configured email, development preview, failed delivery, and no provider; a simulated WhatsApp result is never styled as a real message to a customer. Business analytics use compact operational cards with explicit “Not tracked” for membership revenue and package sales rather than invented numbers. Mobile Grow forms stack to one column; no dense rule editor or node-based workflow canvas is introduced.

## Professional insight pattern

Keep Professional’s dashboard concise: four revenue cards, two explanation-rich operational panels, and a small row for customers, peak time, and plan usage. The report page uses full workspace width but only five tabs (Overview, Revenue, Bookings, Courts & spaces, Customers). A compact filter bar controls one date period plus optional sport, space, and status. Charts use restrained teal for booked value and a lighter paired shade for collected; labels/tooltips state actual values. Heatmap cells include counts and accessible text so color is not the sole signal. Zero-denominator rates show “—”, not a misleading 0%. On mobile, metric cards reduce to two columns, report panels stack, and the heatmap scrolls horizontally. Scheduled-report setup has one short form and a prominent missing-email configuration notice; never style a preview as delivered.

## Philosophy

The interface should feel premium, calm, professional, and easy for a non-technical venue owner to scan. Common information comes first; advanced controls will use progressive disclosure when those workflows exist. The owner workspace and public booking experience intentionally have different visual treatments.

## Brand and typography

The temporary name comes from `src/lib/brand.ts` and can be changed with `NEXT_PUBLIC_PRODUCT_NAME`. The single accent is the `--brand` CSS custom property, initialized from the validated `NEXT_PUBLIC_BRAND_ACCENT` hex value; its default is `#176b5b`. Check contrast before changing it. The parent company is Nexura Labs.

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

Starter payment settings use two equal-height plan cards: a neutral current-plan summary and a restrained green Professional highlight with a small lightning icon. The comparison action stays inside the authenticated workspace at Settings → Plans, rather than sending owners to public marketing. Plan preview copy comes from one presentation catalog shared with landing pricing; payment permissions remain in the separate entitlement model. A compact current-plan badge sits beneath the Slotra logo in the desktop sidebar and inside the mobile navigation panel, linked to Plans; it does not crowd the top bar. The Professional comparison card has a clearly labelled owner-only **sandbox test** action when configured; it requests only a contact number and states that no real money or automatic renewal is involved. Business purchase remains a preview even while its Grow workflows are implemented; Pro is a later phase. Never style this test as a live subscription purchase or connected venue gateway.

## Starter operational views

The dashboard uses compact real-data metric cards, a two-column schedule/court-status area, a monthly usage meter, and one context-specific warning only after usage reaches 70%. At mobile widths, columns stack; schedule and status remain readable without a horizontal desktop table. Reports intentionally use the full workspace width: period tabs, four concise totals, one large activity chart, and small outcome/export sections. Bar, Trend, and Data are alternate views of the same server-calculated daily/monthly series, not separate analytics products. The customer metric is explicitly “New customers,” meaning records created in the selected period. Professional upsell appears as one restrained preview at the bottom, never as a fake purchase button.


