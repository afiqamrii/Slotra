"use client";

import { useEffect, useState, useTransition } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { useRouter } from "next/navigation";
import { bookingSlotsAction, createStaffBookingAction, eligibleCreditsAction, eligiblePackagesAction, searchBookingCustomersAction } from "@/app/actions/bookings";
import { bookingTime } from "@/lib/booking-format";

type Branch = { id: string; name: string; timezone: string; isActive: boolean };
type Space = { id: string; branchId: string; name: string; status: string; sportName: string; bookingIntervalMinutes: number; minimumDurationMinutes: number; maximumDurationMinutes: number | null };
type Customer = { id: string; name: string; phone: string; email: string | null; previousBookings: number };
type Slot = { startAt: string; endAt: string };
const periods = ["Morning", "Afternoon", "Evening"] as const;

export function BookingQuickForm({ branches, spaces, initialBranchId, initialResourceId, initialDate, initialStartAt, walkIn, businessEnabled }: {
  branches: Branch[]; spaces: Space[]; initialBranchId: string; initialResourceId: string | null;
  initialDate: string; initialStartAt: string | null; walkIn: boolean; businessEnabled: boolean;
}) {
  const router = useRouter();
  const first = spaces.find(item => item.id === initialResourceId && item.status === "ACTIVE")
    ?? spaces.find(item => item.branchId === initialBranchId && item.status === "ACTIVE");
  const [branchId, setBranchId] = useState(initialBranchId);
  const [sport, setSport] = useState(first?.sportName ?? "");
  const [resourceId, setResourceId] = useState(first?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [duration, setDuration] = useState(first?.minimumDurationMinutes ?? 60);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [startAt, setStartAt] = useState(initialStartAt ?? "");
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [slotError, setSlotError] = useState("");
  const [customerMode, setCustomerMode] = useState<"existing" | "new" | "guest">(walkIn ? "guest" : "existing");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", email: "" });
  const [notes, setNotes] = useState("");
  const [packages, setPackages] = useState<{ id: string; name: string; remainingMinutes: number; afterMinutes: number }[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [credits, setCredits] = useState<{ id: string; name: string; remainingMinutes: number; afterMinutes: number }[]>([]);
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const branch = branches.find(item => item.id === branchId);
  const space = spaces.find(item => item.id === resourceId);
  const branchSpaces = spaces.filter(item => item.branchId === branchId && item.status === "ACTIVE");
  const sports = [...new Set(branchSpaces.map(item => item.sportName))];
  const selectedSlot = slots.find(item => item.startAt === startAt);
  const checkingSlots = slotsLoading && Boolean(branchId && resourceId && date && duration);
  const quickDurations = [30, 60, 120].filter(value => space && value >= space.minimumDurationMinutes &&
    value % space.bookingIntervalMinutes === 0 && (space.maximumDurationMinutes === null || value <= space.maximumDurationMinutes));

  useEffect(() => {
    if (!branchId || !resourceId || !date || !duration) return;
    let active = true;
    bookingSlotsAction({ branchId, resourceId, localDate: date, durationMinutes: duration,
      customerId: customerMode === "existing" ? selectedCustomer?.id : undefined }).then(result => {
      if (!active) return;
      setSlots(result.slots); setSlotError(result.error ?? "");
      setStartAt(previous => result.slots.some(slot => slot.startAt === previous) ? previous :
        result.slots.find(slot => slot.startAt === initialStartAt)?.startAt ?? result.slots[0]?.startAt ?? "");
      setSlotsLoading(false);
    }).catch(() => { if (active) { setSlots([]); setSlotError("Could not check times. Try again."); setSlotsLoading(false); } });
    return () => { active = false; };
  }, [branchId, resourceId, date, duration, initialStartAt, refreshKey, selectedCustomer, customerMode]);

  useEffect(() => {
    if (customerMode !== "existing" || query.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => searchBookingCustomersAction(query).then(result => {
      if (active) { setMatches(result.matches); setSearching(false); }
    }).catch(() => { if (active) { setMatches([]); setSearching(false); } }), 250);
    return () => { active = false; clearTimeout(timer); };
  }, [customerMode, query]);

  useEffect(() => {
    if (!businessEnabled || customerMode !== "existing" || !selectedCustomer || !resourceId) return;
    let active = true;
    eligiblePackagesAction(selectedCustomer.id, resourceId, duration).then(result => {
      if (active) {
        setPackages(result.packages);
        setSelectedPackageId(previous => result.packages.some(item => item.id === previous) ? previous : "");
      }
    }).catch(() => { if (active) { setPackages([]); setSelectedPackageId(""); } });
    return () => { active = false; };
  }, [businessEnabled, customerMode, selectedCustomer, resourceId, duration]);

  useEffect(() => {
    if (!businessEnabled || customerMode !== "existing" || !selectedCustomer || !resourceId || !startAt) return;
    let active = true;
    eligibleCreditsAction(selectedCustomer.id, resourceId, duration, startAt).then(result => {
      if (active) {
        setCredits(result.credits);
        setSelectedMembershipId(previous => result.credits.some(item => item.id === previous) ? previous : "");
      }
    }).catch(() => { if (active) { setCredits([]); setSelectedMembershipId(""); } });
    return () => { active = false; };
  }, [businessEnabled, customerMode, selectedCustomer, resourceId, duration, startAt]);

  function chooseBranch(id: string) {
    const next = spaces.find(item => item.branchId === id && item.status === "ACTIVE");
    setBranchId(id); setSport(next?.sportName ?? ""); chooseSpace(next?.id ?? "");
  }
  function chooseSport(name: string) {
    setSport(name); chooseSpace(branchSpaces.find(item => item.sportName === name)?.id ?? "");
  }
  function chooseSpace(id: string) {
    if (id === resourceId) return;
    const next = spaces.find(item => item.id === id);
    setResourceId(id); setDuration(next?.minimumDurationMinutes ?? 60);
    setPackages([]); setSelectedPackageId("");
    setCredits([]); setSelectedMembershipId("");
    setSlots([]); setStartAt(""); setSlotsLoading(true); setError("");
  }
  function chooseDate(value: string) { if (value === date) return; setDate(value); setCredits([]); setSelectedMembershipId(""); setSlots([]); setStartAt(""); setSlotsLoading(true); }
  function chooseDuration(value: number) { if (value === duration) return; setDuration(value); setPackages([]); setSelectedPackageId(""); setCredits([]); setSelectedMembershipId(""); setSlots([]); setStartAt(""); setSlotsLoading(true); }
  function refreshCustomerAvailability() {
    setSlots([]); setStartAt(""); setSlotsLoading(true);
    setPackages([]); setSelectedPackageId("");
    setCredits([]); setSelectedMembershipId("");
  }
  function quickDate(days: number) {
    const value = Temporal.Now.zonedDateTimeISO(branch?.timezone ?? "Asia/Kuala_Lumpur").toPlainDate().add({ days }).toString();
    chooseDate(value);
  }
  function period(slot: Slot) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: branch?.timezone ?? "Asia/Kuala_Lumpur", hour: "2-digit", hourCycle: "h23" }).format(new Date(slot.startAt)));
    return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!selectedSlot) { setError("Choose an available time."); return; }
    if (customerMode === "existing" && !selectedCustomer) { setError("Choose a customer, create one, or select Guest."); return; }
    if (customerMode === "new" && (!newCustomer.name.trim() || !newCustomer.phone.trim())) { setError("Enter the customer's name and phone."); return; }
    startTransition(async () => {
      const result = await createStaffBookingAction({ branchId, resourceId, startAt: selectedSlot.startAt, endAt: selectedSlot.endAt,
        source: walkIn ? "WALK_IN" : "STAFF", notes,
        customerId: customerMode === "existing" ? selectedCustomer?.id : undefined,
        newCustomer: customerMode === "new" ? newCustomer : undefined,
        customerPackageId: selectedPackageId || undefined,
        customerMembershipId: selectedMembershipId || undefined,
        promoCode: promoCode.trim() || undefined });
      if (result.error) setError(result.error);
      else if (result.id) router.push("/bookings/" + result.id);
    });
  }

  return <form className="booking-quick-layout" onSubmit={submit}>
    <div className="booking-quick-steps">
      <section className="foundation-card booking-quick-section"><div className="booking-step-title"><span>1</span><div><h2>Choose a space</h2><p>Pick a sport, then tap the court or space.</p></div></div>
        {branches.length > 1 && <label className="venue-field"><span>Branch</span><select value={branchId} onChange={event => chooseBranch(event.target.value)}>{branches.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {sports.length > 1 && <div className="booking-choice-row" role="group" aria-label="Sport">{sports.map(name => <button type="button" key={name} aria-pressed={sport === name} className={sport === name ? "booking-chip selected" : "booking-chip"} onClick={() => chooseSport(name)}>{name}</button>)}</div>}
        <div className="booking-space-options" role="group" aria-label="Court or space">{branchSpaces.filter(item => item.sportName === sport).map(item => <button type="button" key={item.id} aria-pressed={resourceId === item.id} className={resourceId === item.id ? "booking-space-choice selected" : "booking-space-choice"} onClick={() => chooseSpace(item.id)}><strong>{item.name}</strong><small>{item.sportName}</small></button>)}</div>
        {!branchSpaces.length && <p className="booking-help">No active courts or spaces in this branch.</p>}
      </section>
      <section className="foundation-card booking-quick-section"><div className="booking-step-title"><span>2</span><div><h2>Pick a time</h2><p>Only times available from your booking rules are shown.</p></div><button type="button" className="text-button booking-refresh" onClick={() => { setSlotsLoading(true); setRefreshKey(value => value + 1); }}>Refresh times</button></div>
        <div className="booking-date-row"><button type="button" className="booking-chip" onClick={() => quickDate(0)}>Today</button><button type="button" className="booking-chip" onClick={() => quickDate(1)}>Tomorrow</button><label className="venue-field"><span>Date</span><input type="date" required value={date} onChange={event => chooseDate(event.target.value)} /></label></div>
        <div className="booking-duration-row"><span>Duration</span>{quickDurations.map(value => <button type="button" key={value} aria-pressed={duration === value} className={duration === value ? "booking-chip selected" : "booking-chip"} onClick={() => chooseDuration(value)}>{value === 60 ? "1 hour" : value === 120 ? "2 hours" : `${value} min`}</button>)}<label className="booking-custom-duration">Custom <input aria-label="Custom duration in minutes" type="number" min={space?.minimumDurationMinutes ?? 1} max={space?.maximumDurationMinutes ?? 1440} step={space?.bookingIntervalMinutes ?? 1} value={duration} onChange={event => chooseDuration(Number(event.target.value))} /></label></div>
        {checkingSlots ? <p className="booking-help" role="status">Checking live availability…</p> : slotError ? <p className="form-alert" role="alert">{slotError}</p> : slots.length ? <div className="booking-time-groups">{periods.map(name => { const times = slots.filter(slot => period(slot) === name); return times.length ? <div className="booking-time-group" key={name}><h3>{name}</h3><div className="booking-time-options">{times.map(slot => <button type="button" key={slot.startAt} aria-pressed={startAt === slot.startAt} className={startAt === slot.startAt ? "booking-time-choice selected" : "booking-time-choice"} onClick={() => setStartAt(slot.startAt)}>{bookingTime(slot.startAt, branch?.timezone ?? "Asia/Kuala_Lumpur")}</button>)}</div></div> : null; })}</div> : <div className="booking-no-slots"><strong>No times available for this choice</strong><span>Try another space, date or duration.</span></div>}
      </section>
      <section className="foundation-card booking-quick-section"><div className="booking-step-title"><span>3</span><div><h2>Who is playing?</h2><p>Find a regular, add someone new, or save as a guest.</p></div></div>
        <div className="booking-choice-row" role="group" aria-label="Customer choice">{([ ["existing", "Find customer"], ["new", "New customer"], ["guest", "Guest / walk-in"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={customerMode === value} className={customerMode === value ? "booking-chip selected" : "booking-chip"} onClick={() => { if (value === customerMode) return; setCustomerMode(value); refreshCustomerAvailability(); setError(""); }}>{label}</button>)}</div>
        {customerMode === "existing" && <><label className="venue-field"><span>Search name, phone or email</span><input type="search" value={query} placeholder="e.g. 0123456789" onChange={event => { setQuery(event.target.value); setSelectedCustomer(null); refreshCustomerAvailability(); setMatches([]); setSearching(event.target.value.trim().length >= 2); }} /></label>{selectedCustomer ? <div className="booking-customer-selected"><strong>{selectedCustomer.name}</strong><span>{selectedCustomer.phone} · {selectedCustomer.previousBookings} previous bookings</span><button type="button" className="text-button" onClick={() => { setSelectedCustomer(null); refreshCustomerAvailability(); }}>Change customer</button></div> : query.trim().length >= 2 && <div className="booking-customer-results">{searching ? <p>Searching…</p> : matches.length ? matches.map(item => <button type="button" key={item.id} onClick={() => { setSelectedCustomer(item); refreshCustomerAvailability(); }}><strong>{item.name}</strong><span>{item.phone} · {item.previousBookings} previous bookings</span><small>Choose customer →</small></button>) : <p>No match. <button type="button" className="text-button" onClick={() => { setCustomerMode("new"); refreshCustomerAvailability(); setNewCustomer(current => ({ ...current, phone: /^\+?[0-9\s-]+$/.test(query) ? query : current.phone })); }}>Create new customer</button></p>}</div>}</>}
        {customerMode === "new" && <div className="booking-customer-new"><label className="venue-field"><span>Name</span><input required value={newCustomer.name} onChange={event => setNewCustomer(current => ({ ...current, name: event.target.value }))} /></label><label className="venue-field"><span>Phone</span><input type="tel" required value={newCustomer.phone} onChange={event => setNewCustomer(current => ({ ...current, phone: event.target.value }))} /></label><label className="venue-field"><span>Email · optional</span><input type="email" value={newCustomer.email} onChange={event => setNewCustomer(current => ({ ...current, email: event.target.value }))} /></label></div>}
        {customerMode === "guest" && <p className="booking-help">No customer record needed. You can still find this booking by its reference.</p>}
        {businessEnabled && customerMode === "existing" && selectedCustomer && (packages.length > 0 || credits.length > 0) && <div className="booking-benefit-choice"><h3>Use playing-time balance?</h3>
          <div className="booking-choice-row"><button type="button" className={!selectedPackageId && !selectedMembershipId ? "booking-chip selected" : "booking-chip"} aria-pressed={!selectedPackageId && !selectedMembershipId} onClick={() => { setSelectedPackageId(""); setSelectedMembershipId(""); }}>Pay normally</button>
            {packages.map(item => <button type="button" key={item.id} className={selectedPackageId === item.id ? "booking-chip selected" : "booking-chip"} aria-pressed={selectedPackageId === item.id}
              onClick={() => { setSelectedPackageId(item.id); setSelectedMembershipId(""); setPromoCode(""); }}>Package: {item.name} · {item.remainingMinutes} → {item.afterMinutes} min</button>)}
            {credits.map(item => <button type="button" key={item.id} className={selectedMembershipId === item.id ? "booking-chip selected" : "booking-chip"} aria-pressed={selectedMembershipId === item.id}
              onClick={() => { setSelectedMembershipId(item.id); setSelectedPackageId(""); setPromoCode(""); }}>Membership: {item.name} · {item.remainingMinutes} → {item.afterMinutes} min</button>)}</div></div>}
        {businessEnabled && !selectedPackageId && !selectedMembershipId && <details className="booking-optional-note"><summary>Promo code · optional</summary>
          <label className="venue-field"><span>Code</span><input value={promoCode} maxLength={40} autoCapitalize="characters" onChange={event => setPromoCode(event.target.value)} /></label></details>}
        <details className="booking-optional-note"><summary>Add a note · optional</summary><label className="venue-field"><span>Front-desk note</span><textarea rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label></details>
      </section>
    </div>
    <aside className="foundation-card booking-quick-summary"><p className="eyebrow">READY TO SAVE</p><h2>{walkIn ? "Walk-in summary" : "Booking summary"}</h2><dl><div><dt>Space</dt><dd>{space?.name ?? "Choose a space"}</dd></div><div><dt>Date</dt><dd>{date || "Choose a date"}</dd></div><div><dt>Time</dt><dd>{selectedSlot ? bookingTime(selectedSlot.startAt, branch?.timezone ?? "Asia/Kuala_Lumpur") : "Choose a time"}</dd></div><div><dt>Duration</dt><dd>{duration} min</dd></div><div><dt>Customer</dt><dd>{customerMode === "guest" ? "Guest / walk-in" : customerMode === "new" ? newCustomer.name || "New customer" : selectedCustomer?.name ?? "Choose a customer"}</dd></div></dl><p className="booking-help">The total is calculated from venue pricing when saved. Availability is checked again to prevent double-booking.</p>{error && <p className="form-alert" role="alert">{error}</p>}<button className="button button-primary booking-submit" type="submit" disabled={busy || slotsLoading || !selectedSlot}>{busy ? "Saving…" : walkIn ? "Create Walk-In" : "Create Booking"}</button>
    </aside>
  </form>;
}
