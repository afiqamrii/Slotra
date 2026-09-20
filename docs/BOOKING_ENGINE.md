# Booking engine

**Status:** Phase 4 domain, Phase 5 staff operations, Phase 6 guest bookings, and the Phase 7 payment foundation with plan-gated checkout are implemented. Migrations through 0012 are applied to the connected Supabase project. Independent-connection PostgreSQL race acceptance and isolated-database guest payment browser submission remain open. No live gateway is connected.

## Entities and tenancy

`bookings` belongs to one organization, branch, and generic resource. Composite foreign keys enforce resource and optional customer ownership. A random `BK-` plus 12-hex-character reference is unique within an organization; collisions are retried up to three times. Start/end are UTC instants, and all monetary snapshots are integer minor currency units. `booking_status_history` records creation and legal status changes, plus reschedule events with previous/new times. It is not an event-sourced model. The current schema does not create a recurring series; a future nullable series key can be added without changing existing bookings.

`subtotal`, `discount_amount`, `tax_amount`, `total_amount`, and `amount_paid` are snapshot columns. Phase 4 reads the branch/sport `base_prices` amount and basis, computes `round(amount_minor * duration_minutes / basis_minutes)` on the server, and initializes discount/tax/paid to zero. The client cannot set totals. Editing the base rate never changes prior bookings. A time-only reschedule keeps the price snapshot. A changed resource or duration uses the current base rate unless the booking has a paid amount, discount, or tax; those cases are rejected until financial adjustment handling exists.

## Time and availability

The server uses the branch IANA timezone for local opening hours and date requests; database instants remain UTC. Temporal converts local schedule boundaries, shifting nonexistent DST boundaries forward and choosing the earlier start/later close on a repeated hour. Slots are distinct UTC instants, so a repeated local hour can produce two slots. A booking duration is elapsed minutes.

A branch must be active, its resource must be ACTIVE, and the full half-open range `[start,end)` must fit within one effective opening window. A resource-specific weekly schedule, when any rows exist, overrides its own week (missing days are closed) and is intersected with branch hours. Without a resource schedule, branch hours apply. The engine checks the previous local day's overnight range as well as the requested day. It rejects manual, maintenance, private-event, and other resource blocks (each with an optional human-readable reason), as well as active overlapping bookings using `start < candidate_end AND end > candidate_start`. Adjacent ranges are allowed.

Starts are aligned to the effective window opening by `booking_interval_minutes`. Duration must be an integer number of minutes, at least the resource minimum, no more than its optional maximum, and a multiple of its interval. Minimum advance minutes and optional maximum advance days are measured from the supplied/server clock as elapsed time. No browser-local time is used. Slot generation advances by the interval in UTC within each effective window, retains starts on the requested local date, and filters each through the same availability checks. Multiple resources are batch-loaded: branch, resource set, weekly hours, blocks, and blocking bookings are fetched in a fixed number of queries, rather than one query per space.

## Reservation and lifecycle

CONFIRMED, CHECKED_IN, and IN_PROGRESS block availability. AWAITING_PAYMENT blocks only when it has an unexpired `hold_expires_at`; legacy AWAITING_PAYMENT without a hold and PENDING do not reserve a slot. CANCELLED, EXPIRED, NO_SHOW, and COMPLETED do not block. Staff creation currently creates `CONFIRMED` directly. Confirming a nonblocking row revalidates availability. Phase 7 adds explicit checkout expiry and the release workflow described below.

Allowed transitions:

| From | To |
| --- | --- |
| PENDING | CONFIRMED, CANCELLED, EXPIRED |
| AWAITING_PAYMENT | CONFIRMED, CANCELLED, EXPIRED |
| CONFIRMED | CHECKED_IN, CANCELLED, NO_SHOW |
| CHECKED_IN | IN_PROGRESS, COMPLETED |
| IN_PROGRESS | COMPLETED |

All other transitions are rejected. Cancellation records timestamp and optional reason and immediately releases the range; refunds and payment tracking are out of scope. Rescheduling is allowed only for PENDING, AWAITING_PAYMENT, or CONFIRMED, excludes itself in conflict checks, and records old/new times, resources, and totals. Time-only moves preserve the monetary snapshot; resource/duration changes follow the explicit repricing policy above.

## Transaction and concurrency boundary

`createBooking`, `rescheduleBooking`, status transitions, and the new block-creation service use short transactions. They acquire the resource row `FOR UPDATE` before reading mutable availability, so operations through these services serialize per resource, including block creation. The booking row is locked after the resource row for lifecycle operations. No network/provider calls occur while holding locks.

The hard backstop is PostgreSQL `bookings_active_resource_no_overlap`: a partial GiST exclusion constraint on organization ID, resource ID, and `tstzrange(start_at,end_at,'[)')` for blocking statuses, using `btree_gist`. It rejects overlapping direct SQL writes and races even if application checks both saw the same free slot. SQLSTATE `23P01` becomes a domain `CONFLICT` error. The constraint also protects updates that move a booking into a blocking state. Database checks enforce valid ranges, statuses, sources, and monetary arithmetic.

An isolated PGlite test sends two booking requests at nearly the same time and observes one success, one failure, and one active row; another test inserts directly to exercise the exclusion constraint. PGlite uses one in-process backend, so **independent-connection PostgreSQL concurrency remains unverified**. Do not declare production concurrency acceptance complete until the same test runs against two real connections on a dedicated PostgreSQL development database.

## Performance and future work

Indexes support organization/branch/start listing, organization/resource/start range lookup, unique references, and history by booking/time. The exclusion constraint creates its own GiST index for active overlap checks. A test loads 20 resources in a fixed number of select calls; a larger development dataset and `EXPLAIN (ANALYZE, BUFFERS)` should be reviewed when a dedicated PostgreSQL database is available. Future work: a configured production expiry scheduler, real provider integration, exception hours, buffers, dynamic pricing/discount/tax, live-provider refunds, quota accounting, recurring series, notifications, and online payment.

## Phase 5 operational integration

Staff list/detail, customer lookup, calendar, and Available Now are read-only, tenant-scoped application queries in `booking-management.ts`. List/search joins bookings, customers, spaces, sports, and branches in one bounded query; customer booking counts use a grouped query. The calendar fetches bookings and blocks in batched branch-local day/week ranges. Available Now reuses the engine's availability snapshot and operating windows, reporting in-use, blocked, maintenance, disabled, closed, or available; it is a point-in-time view that should be refreshed for live reception use.

Manual and walk-in creation request slots from `availableSlotsForResources`, then call `createBooking` to recheck all rules under a resource lock. Minimal inline customer creation occurs in the same transaction, so a failed booking leaves no orphan customer. No client-submitted total is accepted. Reschedule accepts a target resource and duration, checks availability excluding itself, and previews the server total. When resource or duration changes, the current branch/sport base rate reprices the booking; a pure time shift retains its original snapshot. Bookings with paid amount, discount, or tax cannot be repriced until payment/adjustment handling exists. Migration 0006 records old/new resource and total in reschedule history. The save repeats validation in a transaction, so the preview is not a hold. Cancellation releases the slot; paid refunds are not claimed. Timed maintenance/private/manual blocks use the existing block service and cannot overlap an active booking.

## Phase 6 guest entry point

Public availability uses the same tenant-scoped snapshot and `evaluateAvailability` as staff operations. For one local date, sport, branch, and duration, it generates candidate starts from effective operating windows, then returns a batched time-by-space grid with available and unavailable states; it does not calculate availability in React. The display price comes from `baseQuote`. The public route bounds dates to today–90 days and the engine additionally enforces each space's advance window, minimum/maximum duration, booking interval, blocks, status, and existing reservations.

`createGuestBooking` shares `createBookingCore` with the staff path. It skips membership only after the public adapter has resolved an active organization by slug and checked the selected space within its active branch and assigned sport. The transaction locks the resource, rechecks availability, calculates the quote, rejects a stale quoted price, associates an exact tenant-scoped phone+email customer or inserts a minimal one, then creates a CONFIRMED ONLINE booking with zero amount paid. A failed transaction does not leave an orphan customer. The client may send a quoted amount only to detect price changes; the server never uses it as the persisted total. No `PENDING` or `AWAITING_PAYMENT` hold is created because Pay at venue is the only Phase 6 mode. Concurrent guest calls retain the same resource lock and PostgreSQL exclusion constraint. PGlite public concurrency tests show exactly one winner; the independent-connection PostgreSQL acceptance test remains open.

## Phase 7 payment holds and verified transitions

Starter resolves to Pay at venue for new public bookings, even if an older online policy remains stored. Professional and higher may initiate online checkout when a supported development adapter is configured; the booking transaction checks `ONLINE_PAYMENTS` and `DEPOSITS` before inserting a payment or hold. Guest Pay at venue stays CONFIRMED with amount paid zero. If the organization chooses an online full/fixed/percentage requirement and a supported merchant adapter is connected, the same creation transaction snapshots `required_now_minor`, creates a pending payment, and stores an AWAITING_PAYMENT hold with a configurable 5–30-minute expiry. The partial GiST overlap constraint includes only AWAITING_PAYMENT rows with a hold timestamp plus CONFIRMED/CHECKED_IN/IN_PROGRESS. The availability evaluator treats a hold as blocking only while `hold_expires_at > now`. Creation and blocking expire stale holds under the existing resource row lock before rechecking. A protected sweep endpoint handles idle holds; production scheduling is still pending.

The paid provider event is verified before processing. In a transaction it claims a unique event, locks resource → booking → payment, verifies the hold is still live, and transitions AWAITING_PAYMENT → CONFIRMED. Failure/expiry goes to EXPIRED. Staff cannot bypass the amount due by using Confirm, and paid holds cannot be rescheduled during checkout. A late paid event records money for refund review but never confirms an expired booking, so a replacement reservation remains protected. `amount_paid` is recomputed from the payment/refund ledger, not incremented by callbacks. Cancellation and refund are separate. TestProvider and ToyyibPay hosted-bill checkout are development-only; no live gateway is connected. ToyyibPay bill creation occurs after commit, and a verified sandbox callback or server-side transaction lookup—not browser status—drives the common payment transition. See `PAYMENTS.md`.


