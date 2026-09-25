"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBranchAction, updateBranchSetupAction } from "@/app/actions/venue";

type SportPrice = { sportTypeId: string; name: string; amountMinor: number; selected?: boolean };
type Hour = { dayOfWeek: number; closed: boolean; startMinute: number; endMinute: number };
type Branch = { id: string; name: string; addressLine1: string | null; addressLine2: string | null;
  city: string | null; state: string | null; postcode: string | null; country: string; timezone: string; isActive: boolean };
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const defaultHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, closed: false,
  startMinute: 480, endMinute: 1440 }));
function clock(minute: number) { return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }
function minute(value: string, overnight = false) { const [hour, min] = value.split(":").map(Number); return hour * 60 + min + (overnight ? 1440 : 0); }

export function BranchCreateForm({ prices, initialHours, timezone, initial }: { prices: SportPrice[];
  initialHours: Hour[]; timezone: string; initial?: Branch }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const startingHours = initialHours.length ? Array.from({ length: 7 }, (_, dayOfWeek) =>
    initialHours.find(row => row.dayOfWeek === dayOfWeek) ?? { dayOfWeek, closed: true, startMinute: 480, endMinute: 1440 }) : defaultHours;
  const [expanded, setExpanded] = useState(() => startingHours.some(row =>
    row.closed !== startingHours[0].closed || row.startMinute !== startingHours[0].startMinute || row.endMinute !== startingHours[0].endMinute));
  const [name, setName] = useState(initial?.name ?? "");
  const [addressLine1, setAddressLine1] = useState(initial?.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(initial?.addressLine2 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "");
  const [postcode, setPostcode] = useState(initial?.postcode ?? "");
  const [country, setCountry] = useState(initial?.country ?? "MY");
  const [active, setActive] = useState(initial?.isActive ?? true);
  const [zone, setZone] = useState(initial?.timezone ?? timezone);
  const [rates, setRates] = useState(prices.map(price => ({ sportTypeId: price.sportTypeId, amountMinor: price.amountMinor, selected: price.selected ?? true })));
  const [hours, setHours] = useState<Hour[]>(startingHours);
  function setHour(day: number, change: Partial<Hour>) {
    setHours(current => current.map(row => !expanded || row.dayOfWeek === day ? { ...row, ...change } : row));
  }
  return <form className="venue-stack" onSubmit={event => { event.preventDefault(); start(async () => {
    const payload = { branch: { name, addressLine1, addressLine2, city, state,
      postcode, country, timezone: zone, isActive: active }, hours,
      prices: rates.filter(rate => rate.selected).map(({ sportTypeId, amountMinor }) => ({ sportTypeId, amountMinor })) };
    const result = initial ? await updateBranchSetupAction(initial.id, payload) : await createBranchAction(payload);
    setError(result.error ?? "");
    if (result.branchId) { if (initial) router.refresh(); else router.push(`/settings/branch?branchId=${result.branchId}`); }
  }); }}>
    <div className="venue-grid"><label className="venue-field"><span>Branch name</span><input required minLength={2} value={name} onChange={event => setName(event.target.value)} placeholder="Kemaman" /></label>
      <label className="venue-field"><span>Address</span><input required value={addressLine1} onChange={event => setAddressLine1(event.target.value)} /></label>
      <label className="venue-field"><span>Address line 2</span><input value={addressLine2} onChange={event => setAddressLine2(event.target.value)} /></label>
      <label className="venue-field"><span>City</span><input required value={city} onChange={event => setCity(event.target.value)} /></label>
      <label className="venue-field"><span>State</span><input required value={state} onChange={event => setState(event.target.value)} /></label>
      <label className="venue-field"><span>Postcode</span><input required value={postcode} onChange={event => setPostcode(event.target.value)} /></label>
      <label className="venue-field"><span>Country code</span><input required maxLength={2} value={country} onChange={event => setCountry(event.target.value.toUpperCase())} /></label>
      <label className="venue-field"><span>Timezone</span><input required value={zone} onChange={event => setZone(event.target.value)} /></label></div>
    {initial && <label className="venue-check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /> Active branch</label>}
    <div><h3>Opening hours</h3><p className="small-note">Start with the first branch’s hours, then adjust this branch.</p>
      <label className="venue-check"><input type="checkbox" checked={!expanded} onChange={event => { if (event.target.checked) setHours(current => current.map(row => ({ ...current[0], dayOfWeek: row.dayOfWeek }))); setExpanded(!event.target.checked); }} /> Same every day</label>
      {(expanded ? hours : [hours[0]]).map(row => <div className="venue-grid" key={row.dayOfWeek}>
        <label className="venue-check"><input type="checkbox" checked={row.closed} onChange={event => setHour(row.dayOfWeek, { closed: event.target.checked })} />{expanded ? days[row.dayOfWeek] : "Closed"}</label>
        <label className="venue-field"><span>Open</span><input type="time" disabled={row.closed} value={clock(row.startMinute)} onChange={event => setHour(row.dayOfWeek, { startMinute: minute(event.target.value) })} /></label>
        <label className="venue-field"><span>Close</span><input type="time" disabled={row.closed} value={clock(row.endMinute)} onChange={event => setHour(row.dayOfWeek, { endMinute: minute(event.target.value, minute(event.target.value) <= row.startMinute) })} /></label>
      </div>)}</div>
    <div><h3>Sports and base prices</h3><p className="small-note">Choose what this branch offers. Rates are per hour in RM and can differ from your first branch.</p>
      {prices.map(price => { const index = rates.findIndex(rate => rate.sportTypeId === price.sportTypeId); const rate = rates[index]; return <div className="venue-grid" key={price.sportTypeId}>
        <label className="venue-check"><input type="checkbox" checked={rate.selected} onChange={event => setRates(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} />{price.name}</label>
        <label className="venue-field"><span>RM / hour</span><input type="number" min="0" max="1000000" step="0.01" disabled={!rate.selected} value={(rate.amountMinor / 100).toFixed(2)} onChange={event => setRates(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, amountMinor: Math.round(Number(event.target.value) * 100) } : item))} /></label>
      </div>; })}</div>
    {error && <p className="form-alert" role="alert">{error}</p>}
    <button className="button button-primary" disabled={busy || !rates.some(rate => rate.selected)}>{busy ? "Saving branch…" : initial ? "Save branch" : "Add branch"}</button>
  </form>;
}
