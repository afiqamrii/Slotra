"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MapPin } from "lucide-react";
import { joinPublicWaitlistAction, publicAvailabilityAction, submitPublicBookingAction } from "@/app/actions/public-booking";
import type { PublicGrid, PublicVenue } from "@/lib/public-booking";
import { publicBookingConfirmationUrl } from "@/lib/product-urls";
import { bookingTimeLabel as timeLabel } from "@/lib/booking-time-label";
import { filterBookingTimes, resolvePaymentChoice, selectablePayments, type TimeOfDay } from "./booking-flow-state";
import "./public-booking-flow.css";

type Selection = { resourceId: string; startAt: string; endAt: string };
type Stage = "slots" | "details" | "review";
function dateAfter(date: string, days: number) {
  const base = new Date(date + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
function dateLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === dateAfter(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(date + "T00:00:00Z"));
}
function fullDate(date: string) {
  return new Intl.DateTimeFormat("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(date + "T00:00:00Z"));
}
function money(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}
export function PublicBookingFlow({ venue, today, initialGrid, initialError }: {
  venue: PublicVenue; today: string; initialGrid: PublicGrid | null; initialError: string | null;
}) {
  const router = useRouter();
  const [sportId, setSportId] = useState(venue.sports[0].id);
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState(60);
  const [grid, setGrid] = useState(initialGrid);
  const [spaceSearch, setSpaceSearch] = useState(initialGrid?.resourceSearch ?? "");
  const [error, setError] = useState<string | null>(initialError);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [stage, setStage] = useState<Stage>("slots");
  const [details, setDetails] = useState({ name: "", phone: "", email: "" });
  const [promoCode, setPromoCode] = useState("");
  const [waitlistSelection, setWaitlistSelection] = useState<Selection | null>(null);
  const [waitlistMessage, setWaitlistMessage] = useState<string | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<"PAY_AT_VENUE" | "ONLINE">(venue.paymentOptions[0]?.value ?? "PAY_AT_VENUE");
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const submittingRef = useRef(false);
  const requestId = useRef(0);
  const flowRef = useRef<HTMLDivElement>(null);
  const timesRef = useRef<HTMLElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const waitlistHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (stage === "slots" && selection) timesRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    else if (stage !== "slots") {
      flowRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      stageHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [stage, selection]);
  useEffect(() => {
    if (waitlistSelection) {
      waitlistHeadingRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
      waitlistHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [waitlistSelection]);
  const selectedSpace = grid?.spaces.find(space => space.id === selection?.resourceId);
  const selectedSport = venue.sports.find(sport => sport.id === sportId);
  const selectedOption = grid?.times.find(row => row.startAt === selection?.startAt)
    ?.options.find(option => option.resourceId === selection?.resourceId);
  const selectedPrice = selectedOption?.priceMinor;
  const selectedDueNow = selectedOption?.dueNowMinor;
  const selectablePaymentOptions = selectablePayments(venue.paymentOptions, venue.paymentMode, selectedDueNow);
  const effectivePaymentChoice = resolvePaymentChoice(selectablePaymentOptions, paymentChoice);
  const visibleTimes = filterBookingTimes(grid?.times ?? [], venue.timezone, timeOfDay, availableOnly);
  const availableTimeCount = grid?.times.filter(row => row.options.some(option => option.available)).length ?? 0;
  const timeLabels = useMemo(() => new Map(
    [...new Set(grid?.times.flatMap(row => [row.startAt, row.endAt]) ?? [])]
      .map(instant => [instant, timeLabel(instant, venue.timezone)]),
  ), [grid, venue.timezone]);

  function refresh(nextSport: string, nextDate: string, nextDuration: number,
    options: { notice?: string; page?: number; resourceSearch?: string } = {}) {
    if (submittingRef.current) return;
    const nextSearch = options.resourceSearch ?? spaceSearch;
    setSportId(nextSport); setDate(nextDate); setDuration(nextDuration);
    setSpaceSearch(nextSearch);
    setSelection(null); setWaitlistSelection(null); setWaitlistMessage(null); setStage("slots"); setGrid(null); setError(options.notice ?? null);
    setPaymentChoice(venue.paymentOptions[0]?.value ?? "PAY_AT_VENUE");
    const id = ++requestId.current;
    startTransition(async () => {
      try {
        const result = await publicAvailabilityAction(venue.slug, {
          branchId: venue.branchId, sportId: nextSport, localDate: nextDate, durationMinutes: nextDuration,
          page: options.page ?? 1, resourceSearch: nextSearch,
        });
        if (id !== requestId.current) return;
        setGrid(result.grid);
        setError(result.error ?? options.notice ?? null);
      } catch {
        if (id === requestId.current) setError("We couldn’t load times. Check your connection and try again.");
      }
    });
  }
  async function submit() {
    if (!selection || selectedPrice === null || selectedPrice === undefined || !effectivePaymentChoice || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true); setError(null);
    let navigating = false;
    try {
      const result = await submitPublicBookingAction(venue.slug, {
        ...details, ...selection, branchId: venue.branchId, durationMinutes: duration, expectedPriceMinor: selectedPrice,
        paymentChoice: effectivePaymentChoice, ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}), website: "",
      });
      if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); navigating = true; }
      else if (result.token) { router.push(publicBookingConfirmationUrl(venue.slug, result.token)); navigating = true; }
      else {
        submittingRef.current = false;
        setError(result.error);
        if (result.error?.includes("slot") || result.error?.includes("time") || result.error?.includes("price"))
          refresh(sportId, date, duration, { notice: result.error, page: grid?.pagination.page });
      }
    } catch {
      setError("We couldn’t confirm the result. Check your email or contact the venue before trying again to avoid a duplicate booking.");
    } finally {
      if (!navigating) { submittingRef.current = false; setSubmitting(false); }
    }
  }
  async function joinList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!waitlistSelection || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true); setWaitlistMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await joinPublicWaitlistAction(venue.slug, {
        ...waitlistSelection, branchId: venue.branchId, name: String(form.get("name") ?? ""),
        phone: String(form.get("phone") ?? ""), email: String(form.get("email") ?? ""),
      });
      if (result.ok) { setWaitlistSelection(null); setWaitlistMessage("You’re on the waitlist. This time is not reserved; we’ll email you if it opens and notifications are available."); }
      else setWaitlistMessage(result.error);
    } catch {
      setWaitlistMessage("We couldn’t reach the venue. Check your connection and try again.");
    } finally { submittingRef.current = false; setSubmitting(false); }
  }
  const dateOptions = Array.from({ length: 7 }, (_, index) => dateAfter(today, index));
  return <div className="public-flow" ref={flowRef}>
    <div className="public-stepper" aria-label="Booking progress">
      {(["Choose a time", "Your details", "Review"] as const).map((label, index) => {
        const active = ["slots", "details", "review"].indexOf(stage) >= index;
        return <div className={active ? "public-step active" : "public-step"} key={label}
          aria-current={["slots", "details", "review"].indexOf(stage) === index ? "step" : undefined}>
          <span>{active && index < ["slots", "details", "review"].indexOf(stage) ? <Check size={14} /> : index + 1}</span>{label}
        </div>;
      })}
    </div>
    {error && <p role="alert" className="public-error">{error}</p>}
    {stage === "slots" && <>
      <section className="public-pick-card" aria-label="Choose sport and date">
        {venue.sports.length > 1 && <div className="public-control-group">
          <h2>What are you playing?</h2>
          <div className="public-choice-row">{venue.sports.map(sport =>
            <button key={sport.id} type="button" aria-pressed={sportId === sport.id}
              className={sportId === sport.id ? "public-choice active" : "public-choice"}
              onClick={() => refresh(sport.id, date, duration, { resourceSearch: "" })}>{sport.name}</button>)}</div>
        </div>}
        <div className="public-control-group">
          <div className="public-control-heading"><h2>Choose a day</h2><span><Clock3 size={15} /> {venue.timezone}</span></div>
          <div className="public-date-row">{dateOptions.map(option =>
            <button key={option} type="button" disabled={!venue.openWeekdays.includes(new Date(option + "T00:00:00Z").getUTCDay())} aria-pressed={date === option}
              className={date === option ? "public-date active" : "public-date"}
              onClick={() => refresh(sportId, option, duration)}>
              <span>{dateLabel(option, today)}</span><small>{venue.openWeekdays.includes(new Date(option + "T00:00:00Z").getUTCDay()) ? option.slice(5) : "Closed"}</small>
            </button>)}</div>
          <label className="public-calendar-input"><CalendarDays size={17} /> Another date
            <input aria-label="Choose another date" type="date" min={today} max={dateAfter(today, 90)}
              value={date} onChange={event => event.target.value && refresh(sportId, event.target.value, duration)} />
          </label>
        </div>
        <div className="public-control-group public-duration">
          <h2>How long?</h2>
          <div className="public-choice-row">{[60, 90, 120].map(minutes =>
            <button type="button" key={minutes} aria-pressed={duration === minutes}
              className={duration === minutes ? "public-choice active" : "public-choice"}
              onClick={() => refresh(sportId, date, minutes)}>{minutes === 60 ? "1 hour" : minutes === 90 ? "1½ hours" : "2 hours"}</button>)}</div>
        </div>
      </section>
      <section className="public-times" ref={timesRef} aria-labelledby="public-times-title" aria-busy={pending}>
        <div className="public-times-heading"><div><p className="public-eyebrow">AVAILABLE TIMES</p>
          <h2 id="public-times-title">{selectedSport?.name} · {fullDate(date)}</h2></div>
          <p>Select a time and {grid?.spaces[0]?.label.toLowerCase() || "space"}.</p></div>
        {(spaceSearch || (grid && grid.pagination.totalSpaces > grid.pagination.pageSize)) && <form className="public-space-search" method="get" onSubmit={event => {
          event.preventDefault(); refresh(sportId, date, duration);
        }}>
          <input type="hidden" name="branch" value={venue.branchId} />
          <label htmlFor="public-space-search">Find a court or space</label>
          <div><input id="public-space-search" name="space" type="search" maxLength={80}
            placeholder="Search by name" value={spaceSearch} onChange={event => setSpaceSearch(event.target.value)} />
            <button className="public-secondary" type="submit" disabled={pending}>Search</button>
            {spaceSearch && <button className="public-secondary" type="button" disabled={pending}
              onClick={() => refresh(sportId, date, duration, { resourceSearch: "" })}>Clear</button>}</div>
        </form>}
        {grid && <nav className="public-space-pagination" aria-label="Browse courts and spaces">
          <p role="status">{grid.pagination.totalSpaces ?
            `Showing ${(grid.pagination.page - 1) * grid.pagination.pageSize + 1}–${Math.min(grid.pagination.page * grid.pagination.pageSize, grid.pagination.totalSpaces)} of ${grid.pagination.totalSpaces} spaces` :
            "No matching spaces"}</p>
          {grid.pagination.totalPages > 1 && <div><button className="public-secondary" type="button"
            disabled={pending || !grid.pagination.hasPrevious}
            onClick={() => refresh(sportId, date, duration, { page: grid.pagination.page - 1, resourceSearch: grid.resourceSearch })}>
            <ChevronLeft size={16} aria-hidden="true" /> Previous spaces</button>
            <span>Page {grid.pagination.page} of {grid.pagination.totalPages}</span>
            <button className="public-secondary" type="button" disabled={pending || !grid.pagination.hasNext}
              onClick={() => refresh(sportId, date, duration, { page: grid.pagination.page + 1, resourceSearch: grid.resourceSearch })}>
              Next spaces <ChevronRight size={16} aria-hidden="true" /></button></div>}
        </nav>}
        {pending ? <div className="public-grid-loading" role="status">
          <div className="public-skeleton" /><div className="public-skeleton" /><div className="public-skeleton" />
          <span>Checking live availability…</span></div> :
          venue.bookingClosed ? <div className="public-empty"><h3>Booking temporarily unavailable</h3><p>This venue cannot accept new bookings right now. Please contact the venue for help.</p></div> :
          !venue.paymentOptions.length ? <div className="public-empty"><h3>Booking temporarily unavailable</h3><p>Online payment is not connected for this venue. Please contact the venue for help.</p></div> :
          !grid ? <div className="public-empty"><h3>Times couldn’t be loaded</h3><p>Your selection is saved. Try checking availability again.</p>
            <button type="button" className="public-secondary public-retry" onClick={() => refresh(sportId, date, duration)}>Try again</button></div> :
          grid.closed ? <div className="public-empty"><h3>Closed on this day</h3><p>Choose another date to find a time to play.</p></div> :
          !grid.spaces.length ? <div className="public-empty"><h3>No matching courts or spaces</h3>
            <p>{grid.resourceSearch ? "Try another name, clear your search or choose another sport." : "Choose another sport or contact the venue for help."}</p></div> :
          !grid.times.some(row => row.options.some(option =>
            option.available || (venue.waitlistEnabled && option.reason === "CONFLICT"))) ?
            <div className="public-empty"><h3>No available times</h3><p>Try another day or a different session length.</p>
              <button type="button" className="public-link-button" disabled={date >= dateAfter(today, 90)} onClick={() => refresh(sportId, dateAfter(date, 1), duration)}>Choose another date <ChevronRight size={16} /></button></div> :
            <>
              <div className="public-time-filters">
                <div className="public-time-filter-heading"><span><strong>{availableTimeCount}</strong> available start {availableTimeCount === 1 ? "time" : "times"} for these spaces</span>
                  <label><input type="checkbox" checked={availableOnly} disabled={submitting}
                    onChange={event => setAvailableOnly(event.target.checked)} /> Available only</label></div>
                <div className="public-time-segments" role="group" aria-label="Filter by time of day">
                  {([["all", "Any time"], ["morning", "Before noon"], ["afternoon", "12–6 pm"], ["evening", "6 pm onward"]] as const).map(([value, label]) =>
                    <button type="button" key={value} aria-pressed={timeOfDay === value} disabled={submitting}
                      onClick={() => setTimeOfDay(value)}>{label}</button>)}
                </div>
                <p role="status">Showing {visibleTimes.length} of {grid.times.length} start times. Availability is checked again when you confirm.</p>
              </div>
              {!visibleTimes.length ? <div className="public-empty"><h3>No times match these filters</h3><p>Show all times or try another day.</p>
                <button type="button" className="public-secondary public-retry" onClick={() => { setTimeOfDay("all"); setAvailableOnly(false); }}>Show all times</button></div> : <>
              <div className="public-grid-desktop"><table><thead><tr><th scope="col">Time</th>
                {grid.spaces.map(space => <th key={space.id} scope="col">{space.name}</th>)}</tr></thead>
                <tbody>{visibleTimes.map(row => <tr key={row.startAt}><th scope="row">{timeLabels.get(row.startAt)}</th>
                  {row.options.map(option => <td key={option.resourceId}>
                    <button type="button" disabled={submitting || (!option.available && !(venue.waitlistEnabled && option.reason === "CONFLICT"))}
                      aria-label={`${grid.spaces.find(space => space.id === option.resourceId)?.name}, ${timeLabels.get(row.startAt)}, ${option.available ? money(option.priceMinor!, venue.currency, venue.locale) : venue.waitlistEnabled && option.reason === "CONFLICT" ? "Full, join waitlist" : "unavailable"}`}
                      onClick={() => option.available ? (setSelection({ resourceId: option.resourceId, startAt: row.startAt, endAt: row.endAt }), setStage("details")) :
                        setWaitlistSelection({ resourceId: option.resourceId, startAt: row.startAt, endAt: row.endAt })}
                      className={option.available ? "public-slot" : "public-slot unavailable"}>
                      {option.available ? money(option.priceMinor!, venue.currency, venue.locale) : option.reason === "CONFLICT" ? venue.waitlistEnabled ? "Full · Notify me" : "Full" : "Unavailable"}
                    </button></td>)}</tr>)}</tbody></table></div>
              <div className="public-grid-mobile">{visibleTimes.map(row => <div className="public-time-group" key={row.startAt}>
                <h3>{timeLabels.get(row.startAt)}</h3>
                <div>{row.options.map(option => {
                  const space = grid.spaces.find(item => item.id === option.resourceId);
                  return <button key={option.resourceId} type="button" disabled={submitting || (!option.available && !(venue.waitlistEnabled && option.reason === "CONFLICT"))}
                    aria-label={`${space?.name}, ${timeLabels.get(row.startAt)}, ${option.available ? money(option.priceMinor!, venue.currency, venue.locale) : venue.waitlistEnabled && option.reason === "CONFLICT" ? "Full, join waitlist" : "unavailable"}`}
                    onClick={() => option.available ? (setSelection({ resourceId: option.resourceId, startAt: row.startAt, endAt: row.endAt }), setStage("details")) :
                      setWaitlistSelection({ resourceId: option.resourceId, startAt: row.startAt, endAt: row.endAt })}
                    className={option.available ? "public-mobile-slot" : "public-mobile-slot unavailable"}>
                    <span>{space?.name}</span><strong>{option.available ? money(option.priceMinor!, venue.currency, venue.locale) : option.reason === "CONFLICT" ? venue.waitlistEnabled ? "Full · Notify me" : "Full" : "Unavailable"}</strong>
                  </button>;
                })}</div></div>)}</div></>}
            </>}
      </section>
      {waitlistMessage && <p className="public-helper" role="status">{waitlistMessage}</p>}
      {waitlistSelection && <section className="public-form-card public-waitlist-card">
        <button className="public-back" type="button" disabled={submitting} onClick={() => setWaitlistSelection(null)}>← Times</button>
        <p className="public-eyebrow">WAITLIST</p><h2 ref={waitlistHeadingRef} tabIndex={-1}>Get notified if this time opens</h2>
        <p className="public-selected-inline">{grid?.spaces.find(space => space.id === waitlistSelection.resourceId)?.name} · {fullDate(date)} · {timeLabel(waitlistSelection.startAt, venue.timezone)} – {timeLabel(waitlistSelection.endAt, venue.timezone)}</p>
        <p className="public-helper">This does not reserve the time. We’ll email you only if notifications are configured and the slot becomes available.</p>
        <form method="post" onSubmit={joinList}>
          <label>Name<input name="name" required minLength={2} maxLength={120} autoComplete="name" disabled={submitting} defaultValue={details.name} /></label>
          <label>Phone<input name="phone" required type="tel" minLength={6} maxLength={30} autoComplete="tel" disabled={submitting} defaultValue={details.phone} /></label>
          <label>Email<input name="email" required type="email" maxLength={254} autoComplete="email" disabled={submitting} defaultValue={details.email} /></label>
          <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Joining…" : "Join waitlist"}</button>
        </form></section>}
    </>}
    {stage === "details" && selection && <section className="public-form-layout">
      <div className="public-form-card">
        <button className="public-back" type="button" onClick={() => setStage("slots")}><ChevronLeft size={17} /> Change time</button>
        <p className="public-eyebrow">YOUR DETAILS</p><h2 ref={stageHeadingRef} tabIndex={-1}>Who’s playing?</h2>
        <p className="public-helper">No account needed. We’ll use these details for your booking.</p>
        <p className="public-selected-inline">{selectedSpace?.name} · {timeLabel(selection.startAt, venue.timezone)} · {selectedPrice === null || selectedPrice === undefined ? "—" : money(selectedPrice, venue.currency, venue.locale)}</p>
        <form method="post" onSubmit={event => { event.preventDefault(); setStage("review"); }}>
          <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={details.name}
            onChange={event => setDetails({ ...details, name: event.target.value })} placeholder="Your name" /></label>
          <label>Phone number<input required type="tel" inputMode="tel" minLength={6} maxLength={30} autoComplete="tel" value={details.phone}
            onChange={event => setDetails({ ...details, phone: event.target.value })} placeholder="+60 12 345 6789" /></label>
          <label>Email address<input required type="email" maxLength={254} autoComplete="email" value={details.email}
            onChange={event => setDetails({ ...details, email: event.target.value })} placeholder="you@example.com" /></label>
          <button className="public-primary" type="submit">Review booking <ChevronRight size={18} /></button>
        </form>
      </div><SelectionSummary venue={venue} selection={selection} spaceName={selectedSpace?.name} spaceLabel={selectedSpace?.label} sportName={selectedSport?.name} date={date} duration={duration} priceMinor={selectedPrice} dueNowMinor={selectedDueNow} paymentChoice={effectivePaymentChoice} /></section>}
    {stage === "review" && selection && <section className="public-form-layout">
      <div className="public-form-card">
        <button className="public-back" type="button" disabled={submitting} onClick={() => setStage("details")}><ChevronLeft size={17} /> Edit details</button>
        <p className="public-eyebrow">ONE LAST LOOK</p><h2 ref={stageHeadingRef} tabIndex={-1}>Review your booking</h2>
        <SelectionSummary venue={venue} selection={selection} spaceName={selectedSpace?.name} spaceLabel={selectedSpace?.label} sportName={selectedSport?.name} date={date} duration={duration} priceMinor={selectedPrice} dueNowMinor={selectedDueNow} paymentChoice={effectivePaymentChoice} />
        <div className="public-review-details"><div><span>Name</span><strong>{details.name}</strong></div>
          <div><span>Phone</span><strong>{details.phone}</strong></div>
          <div><span>Email</span><strong>{details.email}</strong></div></div>
        <details className="public-promo"><summary>Have a promo code?</summary>
          <label>Promo code<input value={promoCode} maxLength={40} autoCapitalize="characters" disabled={submitting}
            onChange={event => setPromoCode(event.target.value)} placeholder="Enter code" /></label>
          <small>The venue will validate your code and show the final total on confirmation.</small>
        </details>
        <fieldset className="public-payment-options" disabled={submitting}><legend>How would you like to pay?</legend>
          {!effectivePaymentChoice && <p role="alert">No payment option is available for this time. Please choose another time or contact the venue.</p>}
          {selectablePaymentOptions.map(option => <label key={option.value} className={effectivePaymentChoice === option.value ? "public-payment-option selected" : "public-payment-option"}>
            <input type="radio" name="paymentChoice" value={option.value} checked={effectivePaymentChoice === option.value}
              onChange={() => setPaymentChoice(option.value)} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>)}
        </fieldset>
        <p className="public-pay-note">{!effectivePaymentChoice ? "Your time has not been reserved." : effectivePaymentChoice === "PAY_AT_VENUE" ? "No online payment is taken. Your booking total remains due at the venue." :
          "Development test checkout only. No real money will move. Your time is confirmed after verified test payment."}</p>
        <button disabled={submitting || !effectivePaymentChoice} type="button" className="public-primary" onClick={submit}>
          {submitting ? "Preparing…" : effectivePaymentChoice === "ONLINE" ? "Continue to test payment" : "Confirm booking"} {!submitting && <ChevronRight size={18} />}</button>
        <p className="public-review-footnote" role="status">{submitting ? "Please wait while we prepare your booking." : effectivePaymentChoice === "PAY_AT_VENUE" ? "Your time is confirmed after you submit." : "Your time is confirmed only after verified payment."}</p>
      </div></section>}
  </div>;

}

function SelectionSummary({ venue, selection, spaceName, spaceLabel, sportName, date, duration, priceMinor, dueNowMinor, paymentChoice }: {
  venue: PublicVenue; selection: Selection; spaceName?: string; spaceLabel?: string;
  sportName?: string; date: string; duration: number; priceMinor: number | null | undefined; dueNowMinor: number | null | undefined;
  paymentChoice: "PAY_AT_VENUE" | "ONLINE" | undefined;
}) {
  return <aside className="public-summary"><p className="public-eyebrow">YOUR SELECTION</p>
    <h3>{venue.name}</h3><p><MapPin size={15} /> {venue.branchName}{venue.city ? ` · ${venue.city}` : ""}</p>
    <dl><div><dt>Sport</dt><dd>{sportName}</dd></div>
      <div><dt>{spaceLabel || "Space"}</dt><dd>{spaceName}</dd></div>
      <div><dt>Date</dt><dd>{fullDate(date)}</dd></div>
      <div><dt>Time</dt><dd>{timeLabel(selection.startAt, venue.timezone)} – {timeLabel(selection.endAt, venue.timezone)}</dd></div>
      <div><dt>Duration</dt><dd>{duration} minutes</dd></div></dl>
    <div className="public-summary-total"><span>Total</span><strong>{priceMinor === null || priceMinor === undefined ? "—" : money(priceMinor, venue.currency, venue.locale)}</strong></div>
    <p className="public-summary-payment">{!paymentChoice ? "No payment option available" : paymentChoice === "PAY_AT_VENUE" ? "Pay at venue · Nothing due now" :
      `Test checkout · ${dueNowMinor === null || dueNowMinor === undefined ? "—" : money(dueNowMinor, venue.currency, venue.locale)} due now`}</p>
  </aside>;
}





