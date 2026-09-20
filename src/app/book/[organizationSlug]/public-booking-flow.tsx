"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MapPin } from "lucide-react";
import { publicAvailabilityAction, submitPublicBookingAction } from "@/app/actions/public-booking";
import type { PublicGrid, PublicVenue } from "@/lib/public-booking";

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
function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone })
    .format(new Date(iso));
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
  const [error, setError] = useState<string | null>(initialError);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [stage, setStage] = useState<Stage>("slots");
  const [details, setDetails] = useState({ name: "", phone: "", email: "" });
  const [paymentChoice, setPaymentChoice] = useState<"PAY_AT_VENUE" | "ONLINE">(venue.paymentOptions[0]?.value ?? "PAY_AT_VENUE");
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const requestId = useRef(0);
  const flowRef = useRef<HTMLDivElement>(null);
  const timesRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (stage === "slots" && selection) timesRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    else if (stage !== "slots") flowRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [stage, selection]);
  const selectedSpace = grid?.spaces.find(space => space.id === selection?.resourceId);
  const selectedSport = venue.sports.find(sport => sport.id === sportId);
  const selectedPrice = grid?.priceMinor;
  const selectablePaymentOptions = venue.paymentOptions.filter(option => option.value !== "ONLINE" ||
    venue.paymentMode !== "TOYYIBPAY_SANDBOX" || (grid?.dueNowMinor ?? 0) >= 100);

  function refresh(nextSport: string, nextDate: string, nextDuration: number, notice?: string) {
    setSportId(nextSport); setDate(nextDate); setDuration(nextDuration);
    setSelection(null); setStage("slots"); setGrid(null); setError(notice ?? null);
    setPaymentChoice(venue.paymentOptions[0]?.value ?? "PAY_AT_VENUE");
    const id = ++requestId.current;
    startTransition(async () => {
      const result = await publicAvailabilityAction(venue.slug, {
        sportId: nextSport, localDate: nextDate, durationMinutes: nextDuration,
      });
      if (id !== requestId.current) return;
      setGrid(result.grid);
      setError(result.error);
    });
  }
  async function submit() {
    if (!selection || selectedPrice === null || selectedPrice === undefined || submitting) return;
    setSubmitting(true); setError(null);
    const result = await submitPublicBookingAction(venue.slug, {
      ...details, ...selection, durationMinutes: duration, expectedPriceMinor: selectedPrice, paymentChoice,
      website: "",
    });
    setSubmitting(false);
    if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
    else if (result.token) router.push(`/book/${venue.slug}/confirmation/${result.token}`);
    else {
      setError(result.error);
      if (result.error?.includes("slot") || result.error?.includes("time") || result.error?.includes("price")) refresh(sportId, date, duration, result.error);
    }
  }
  const dateOptions = Array.from({ length: 7 }, (_, index) => dateAfter(today, index));
  return <div className="public-flow" ref={flowRef}>
    <div className="public-stepper" aria-label="Booking progress">
      {(["Choose a time", "Your details", "Review"] as const).map((label, index) => {
        const active = ["slots", "details", "review"].indexOf(stage) >= index;
        return <div className={active ? "public-step active" : "public-step"} key={label}>
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
              onClick={() => refresh(sport.id, date, duration)}>{sport.name}</button>)}</div>
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
      <section className="public-times" ref={timesRef} aria-labelledby="public-times-title">
        <div className="public-times-heading"><div><p className="public-eyebrow">AVAILABLE TIMES</p>
          <h2 id="public-times-title">{selectedSport?.name} · {fullDate(date)}</h2></div>
          <p>Select a time and {grid?.spaces[0]?.label.toLowerCase() || "space"}.</p></div>
        {pending || !grid ? <div className="public-grid-loading" role="status">
          <div className="public-skeleton" /><div className="public-skeleton" /><div className="public-skeleton" />
          <span>Checking live availability…</span></div> :
          venue.bookingClosed ? <div className="public-empty"><h3>Booking temporarily unavailable</h3><p>This venue cannot accept new bookings right now. Please contact the venue for help.</p></div> :
          !venue.paymentOptions.length ? <div className="public-empty"><h3>Booking temporarily unavailable</h3><p>Online payment is not connected for this venue. Please contact the venue for help.</p></div> :
          grid.closed ? <div className="public-empty"><h3>Closed on this day</h3><p>Choose another date to find a time to play.</p></div> :
          !grid.spaces.length || !grid.times.some(row => row.options.some(option => option.available)) ?
            <div className="public-empty"><h3>No available times</h3><p>Try another day or a different session length.</p>
              <button type="button" className="public-link-button" onClick={() => refresh(sportId, dateAfter(date, 1), duration)}>Choose another date <ChevronRight size={16} /></button></div> :
            <>
              <div className="public-grid-desktop"><table><thead><tr><th scope="col">Time</th>
                {grid.spaces.map(space => <th key={space.id} scope="col">{space.name}</th>)}</tr></thead>
                <tbody>{grid.times.map(row => <tr key={row.startAt}><th scope="row">{timeLabel(row.startAt, venue.timezone)}</th>
                  {row.options.map(option => <td key={option.resourceId}>
                    <button type="button" disabled={!option.available}
                      aria-label={`${grid.spaces.find(space => space.id === option.resourceId)?.name}, ${timeLabel(row.startAt, venue.timezone)}, ${option.available ? money(grid.priceMinor!, venue.currency, venue.locale) : "unavailable"}`}
                      onClick={() => { setSelection({ resourceId: option.resourceId, startAt: row.startAt, endAt: row.endAt }); setStage("details"); }}
                      className={option.available ? "public-slot" : "public-slot unavailable"}>
                      {option.available ? money(grid.priceMinor!, venue.currency, venue.locale) : option.reason === "CONFLICT" ? "Full" : "Unavailable"}
                    </button></td>)}</tr>)}</tbody></table></div>
              <div className="public-grid-mobile">{grid.times.map(row => <div className="public-time-group" key={row.startAt}>
                <h3>{timeLabel(row.startAt, venue.timezone)}</h3>
                <div>{row.options.map(option => {
                  const space = grid.spaces.find(item => item.id === option.resourceId);
                  return <button key={option.resourceId} type="button" disabled={!option.available}
                    onClick={() => { setSelection({ resourceId: option.resourceId, startAt: row.startAt, endAt: row.endAt }); setStage("details"); }}
                    className={option.available ? "public-mobile-slot" : "public-mobile-slot unavailable"}>
                    <span>{space?.name}</span><strong>{option.available ? money(grid.priceMinor!, venue.currency, venue.locale) : option.reason === "CONFLICT" ? "Full" : "Unavailable"}</strong>
                  </button>;
                })}</div></div>)}</div>
            </>}
      </section>
    </>}
    {stage === "details" && selection && <section className="public-form-layout">
      <div className="public-form-card">
        <button className="public-back" type="button" onClick={() => setStage("slots")}><ChevronLeft size={17} /> Change time</button>
        <p className="public-eyebrow">YOUR DETAILS</p><h2>Who’s playing?</h2>
        <p className="public-helper">No account needed. We’ll use these details for your booking.</p>
        <p className="public-selected-inline">{selectedSpace?.name} · {timeLabel(selection.startAt, venue.timezone)} · {selectedPrice === null || selectedPrice === undefined ? "—" : money(selectedPrice, venue.currency, venue.locale)}</p>
        <form onSubmit={event => { event.preventDefault(); setStage("review"); }}>
          <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={details.name}
            onChange={event => setDetails({ ...details, name: event.target.value })} placeholder="Your name" /></label>
          <label>Phone number<input required type="tel" inputMode="tel" minLength={6} maxLength={30} autoComplete="tel" value={details.phone}
            onChange={event => setDetails({ ...details, phone: event.target.value })} placeholder="+60 12 345 6789" /></label>
          <label>Email address<input required type="email" maxLength={254} autoComplete="email" value={details.email}
            onChange={event => setDetails({ ...details, email: event.target.value })} placeholder="you@example.com" /></label>
          <button className="public-primary" type="submit">Review booking <ChevronRight size={18} /></button>
        </form>
      </div><SelectionSummary venue={venue} selection={selection} spaceName={selectedSpace?.name} spaceLabel={selectedSpace?.label} sportName={selectedSport?.name} date={date} duration={duration} priceMinor={selectedPrice} dueNowMinor={grid?.dueNowMinor} paymentChoice={paymentChoice} /></section>}
    {stage === "review" && selection && <section className="public-form-layout">
      <div className="public-form-card">
        <button className="public-back" type="button" onClick={() => setStage("details")}><ChevronLeft size={17} /> Edit details</button>
        <p className="public-eyebrow">ONE LAST LOOK</p><h2>Review your booking</h2>
        <SelectionSummary venue={venue} selection={selection} spaceName={selectedSpace?.name} spaceLabel={selectedSpace?.label} sportName={selectedSport?.name} date={date} duration={duration} priceMinor={selectedPrice} dueNowMinor={grid?.dueNowMinor} paymentChoice={paymentChoice} />
        <div className="public-review-details"><div><span>Name</span><strong>{details.name}</strong></div>
          <div><span>Phone</span><strong>{details.phone}</strong></div>
          <div><span>Email</span><strong>{details.email}</strong></div></div>
        <fieldset className="public-payment-options"><legend>How would you like to pay?</legend>
          {selectablePaymentOptions.map(option => <label key={option.value} className={paymentChoice === option.value ? "public-payment-option selected" : "public-payment-option"}>
            <input type="radio" name="paymentChoice" value={option.value} checked={paymentChoice === option.value}
              onChange={() => setPaymentChoice(option.value)} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>)}
        </fieldset>
        <p className="public-pay-note">{paymentChoice === "PAY_AT_VENUE" ? "No online payment is taken. Your booking total remains due at the venue." :
          "Development test checkout only. No real money will move. Your time is confirmed after verified test payment."}</p>
        <button disabled={submitting} type="button" className="public-primary" onClick={submit}>
          {submitting ? "Preparing…" : paymentChoice === "ONLINE" ? "Continue to test payment" : "Confirm booking"} {!submitting && <ChevronRight size={18} />}</button>
        <p className="public-review-footnote">{paymentChoice === "PAY_AT_VENUE" ? "Your time is confirmed after you submit." : "Your time is confirmed only after verified payment."}</p>
      </div></section>}
  </div>;

}

function SelectionSummary({ venue, selection, spaceName, spaceLabel, sportName, date, duration, priceMinor, dueNowMinor, paymentChoice }: {
  venue: PublicVenue; selection: Selection; spaceName?: string; spaceLabel?: string;
  sportName?: string; date: string; duration: number; priceMinor: number | null | undefined; dueNowMinor: number | null | undefined;
  paymentChoice: "PAY_AT_VENUE" | "ONLINE";
}) {
  return <aside className="public-summary"><p className="public-eyebrow">YOUR SELECTION</p>
    <h3>{venue.name}</h3><p><MapPin size={15} /> {venue.branchName}{venue.city ? ` · ${venue.city}` : ""}</p>
    <dl><div><dt>Sport</dt><dd>{sportName}</dd></div>
      <div><dt>{spaceLabel || "Space"}</dt><dd>{spaceName}</dd></div>
      <div><dt>Date</dt><dd>{fullDate(date)}</dd></div>
      <div><dt>Time</dt><dd>{timeLabel(selection.startAt, venue.timezone)} – {timeLabel(selection.endAt, venue.timezone)}</dd></div>
      <div><dt>Duration</dt><dd>{duration} minutes</dd></div></dl>
    <div className="public-summary-total"><span>Total</span><strong>{priceMinor === null || priceMinor === undefined ? "—" : money(priceMinor, venue.currency, venue.locale)}</strong></div>
    <p className="public-summary-payment">{paymentChoice === "PAY_AT_VENUE" ? "Pay at venue · Nothing due now" :
      `Test checkout · ${dueNowMinor === null || dueNowMinor === undefined ? "—" : money(dueNowMinor, venue.currency, venue.locale)} due now`}</p>
  </aside>;
}





