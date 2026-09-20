"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkSlugAction, finishSetupAction } from "@/app/actions/venue";
import { generatedNames, spaceTerm } from "@/lib/space-terminology";

type Sport = { id: string; name: string; code: string };
type Space = { name: string; sportTypeId: string; bookingIntervalMinutes: number; minimumDurationMinutes: number; maximumDurationMinutes: number | null };
type Day = { dayOfWeek: number; closed: boolean; startMinute: number; endMinute: number };
type Draft = {
  name: string; displayName: string; contactPhone: string; contactEmail: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postcode: string; country: string;
  timezone: string; currency: string; locale: string; slug: string; primaryColor: string;
  sports: string[]; branch: { name: string; addressLine1: string; addressLine2: string; city: string; state: string; postcode: string; country: string; timezone: string; isActive: boolean };
  resources: Space[]; hours: Day[]; prices: { sportTypeId: string; amountMinor: number }[];
};
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const titles = ["Business details", "Sports offered", "First branch", "Courts & spaces", "Opening hours", "Booking defaults", "Base pricing", "Branding", "Booking page", "Review & finish"];
const initial = (name: string, slug: string): Draft => ({
  name, displayName: name, contactPhone: "", contactEmail: "", addressLine1: "", addressLine2: "",
  city: "", state: "", postcode: "", country: "MY", timezone: "Asia/Kuala_Lumpur", currency: "MYR", locale: "en-MY",
  slug, primaryColor: "#176b5b", sports: [],
  branch: { name: "Main Venue", addressLine1: "", addressLine2: "", city: "", state: "", postcode: "", country: "MY", timezone: "Asia/Kuala_Lumpur", isActive: true },
  resources: [], hours: days.map((_, dayOfWeek) => ({ dayOfWeek, closed: false, startMinute: 480, endMinute: 1440 })), prices: [],
});
function time(minute: number) { return `${String(Math.floor(minute % 1440 / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }
function parseTime(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
const addressKeys = ["addressLine1", "addressLine2", "city", "state", "postcode", "country"] as const;
export function VenueWizard({ organizationId, name, slug, catalog }: { organizationId: string; name: string; slug: string; catalog: Sport[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => initial(name, slug));
  const [sameAddress, setSameAddress] = useState(true);
  const [daily, setDaily] = useState(true);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState("");
  const [busy, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const saved = localStorage.getItem(`venue-setup:${organizationId}`); if (saved) { const state = JSON.parse(saved); setDraft(state.draft ?? state); setSameAddress(state.sameAddress ?? true); setDaily(state.daily ?? true); setStep(state.step ?? 0); } } catch { /* private mode */ }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [organizationId]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(`venue-setup:${organizationId}`, JSON.stringify({ draft, sameAddress, daily, step })); } catch { /* private mode */ }
  }, [draft, organizationId, loaded, sameAddress, daily, step]);  function patch<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function branch(key: keyof Draft["branch"], value: string | boolean) { setDraft(current => ({ ...current, branch: { ...current.branch, [key]: value } })); }
  function selectSport(sport: Sport) {
    setDraft(current => {
      const selected = current.sports.includes(sport.id);
      return { ...current, sports: selected ? current.sports.filter(id => id !== sport.id) : [...current.sports, sport.id],
        resources: selected ? current.resources.filter(item => item.sportTypeId !== sport.id) : current.resources,
        prices: selected ? current.prices.filter(item => item.sportTypeId !== sport.id) : [...current.prices, { sportTypeId: sport.id, amountMinor: 2500 }] };
    });
  }
  function count(sport: Sport, value: number) {
    const amount = Math.max(0, Math.min(100, value || 0));
    setDraft(current => {
      const existing = current.resources.filter(item => item.sportTypeId === sport.id);
      const others = current.resources.filter(item => item.sportTypeId !== sport.id);
      const names = generatedNames(sport, amount);
      return { ...current, resources: [...others, ...names.map((name, index) => existing[index] ?? { name, sportTypeId: sport.id, bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null })] };
    });
  }
  function next() {
    setError("");
    if (step === 0 && (!draft.name.trim() || !draft.contactPhone.trim() || !draft.contactEmail.includes("@") || !draft.addressLine1.trim() || !draft.city.trim() || !draft.state.trim() || !draft.postcode.trim())) return setError("Complete the business and contact details to continue.");
    if (step === 1 && !draft.sports.length) return setError("Choose at least one sport.");
    if (step === 2 && (!draft.branch.name.trim() || !(sameAddress ? draft.addressLine1 : draft.branch.addressLine1).trim())) return setError("Add a branch name and address.");
    if (step === 3 && (!draft.resources.length || draft.resources.some(item => !item.name.trim()) || new Set(draft.resources.map(item => item.name.toLowerCase())).size !== draft.resources.length)) return setError("Add at least one space with a unique name.");
    if (step === 4 && draft.hours.some(day => !day.closed && day.endMinute <= day.startMinute)) return setError("Closing must be after opening. For an overnight close, choose the next-day option.");
    if (step === 8 && availability !== "Available") return setError("Check that your booking page address is available.");
    setStep(value => Math.min(9, value + 1));
  }
  function finish() {
    setError("");
    const payload = { ...draft, branch: sameAddress ? { ...draft.branch, ...Object.fromEntries(addressKeys.map(key => [key, draft[key]])) } : draft.branch };
    startTransition(async () => {
      const result = await finishSetupAction(payload);
      if (result.error) setError(result.error);
      else { localStorage.removeItem(`venue-setup:${organizationId}`); router.replace("/dashboard?setup=complete"); router.refresh(); }
    });
  }
  const field = (label: string, value: string, onChange: (value: string) => void, type = "text", required = false) =>
    <label className="venue-field"><span>{label}</span><input type={type} value={value} required={required} onChange={event => onChange(event.target.value)} /></label>;
  return <div className="venue-wizard">
    <div className="venue-progress"><span>Step {step + 1} of {titles.length}</span><span>{titles[step]}</span></div>
    <div className="venue-progress-track"><span style={{ width: `${(step + 1) * 10}%` }} /></div>
    <h1>{step === 3 ? "How many courts or spaces do you have?" : titles[step]}</h1>
    <p className="venue-intro">{["Tell us where customers can find you.", "Choose everything your venue offers.", "Start with one location. You can edit it later.", "We’ll name them for you. You can make changes below.", "When can guests visit your venue?", "Keep bookings simple to start.", "Set one starting hourly rate per sport.", "Make your booking page feel like your business.", "Reserve an easy-to-share address.", "Everything look right?"][step]}</p>
    {step === 0 && <div className="venue-grid">
      {field("Business / venue name", draft.name, value => patch("name", value), "text", true)}
      {field("Contact phone", draft.contactPhone, value => patch("contactPhone", value), "tel", true)}
      {field("Contact email", draft.contactEmail, value => patch("contactEmail", value), "email", true)}
      {field("Address", draft.addressLine1, value => patch("addressLine1", value), "text", true)}
      {field("Address line 2 (optional)", draft.addressLine2, value => patch("addressLine2", value))}
      {field("City", draft.city, value => patch("city", value), "text", true)}
      {field("State", draft.state, value => patch("state", value), "text", true)}
      {field("Postcode", draft.postcode, value => patch("postcode", value), "text", true)}
      {field("Country code", draft.country, value => patch("country", value.toUpperCase()), "text", true)}
      {field("Timezone", draft.timezone, value => patch("timezone", value), "text", true)}
      {field("Currency code", draft.currency, value => patch("currency", value.toUpperCase()), "text", true)}
      {field("Locale", draft.locale, value => patch("locale", value), "text", true)}
    </div>}
    {step === 1 && <div className="sport-options">{catalog.map(sport => <label key={sport.id} className="sport-choice"><input type="checkbox" checked={draft.sports.includes(sport.id)} onChange={() => selectSport(sport)} />{sport.name}</label>)}</div>}
    {step === 2 && <div className="venue-grid">
      {field("Branch name", draft.branch.name, value => branch("name", value), "text", true)}
      <label className="venue-check"><input type="checkbox" checked={sameAddress} onChange={event => setSameAddress(event.target.checked)} /> Use business address</label>
      {!sameAddress && addressKeys.map(key => field(key.replace(/([A-Z])/g, " $1"), draft.branch[key], value => branch(key, key === "country" ? value.toUpperCase() : value)))}
      {field("Branch timezone", draft.branch.timezone, value => branch("timezone", value))}
      <label className="venue-check"><input type="checkbox" checked={draft.branch.isActive} onChange={event => branch("isActive", event.target.checked)} /> Branch is active</label>
    </div>}
    {step === 3 && <div className="venue-stack">{catalog.filter(sport => draft.sports.includes(sport.id)).map(sport => {
      const items = draft.resources.map((item, index) => ({ ...item, index })).filter(item => item.sportTypeId === sport.id);
      return <section className="venue-subsection" key={sport.id}><div className="venue-row"><strong>{sport.name}</strong><label>{spaceTerm(sport.code)}s <input className="count-input" type="number" min="0" max="100" value={items.length} onChange={event => count(sport, Number(event.target.value))} /></label></div>
        {items.map(item => <div className="venue-row" key={item.index}><input aria-label={`Name ${sport.name} space ${item.index + 1}`} value={item.name} onChange={event => patch("resources", draft.resources.map((space, index) => index === item.index ? { ...space, name: event.target.value } : space))} /><button className="text-button" type="button" onClick={() => patch("resources", draft.resources.filter((_, index) => index !== item.index))}>Remove</button></div>)}
        <button className="text-button" type="button" onClick={() => patch("resources", [...draft.resources, { name: `${sport.name} ${spaceTerm(sport.code)} ${items.length + 1}`, sportTypeId: sport.id, bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null }])}>+ Add another {spaceTerm(sport.code).toLowerCase()}</button>
      </section>;
    })}</div>}
    {step === 4 && <div className="venue-stack">
      <label className="venue-check"><input type="checkbox" checked={daily} onChange={event => { setDaily(event.target.checked); if (event.target.checked) patch("hours", days.map((_, dayOfWeek) => ({ ...draft.hours[0], dayOfWeek }))); }} /> Same every day</label>
      {(daily ? draft.hours.slice(0, 1) : draft.hours).map(day => <div className="hours-row" key={day.dayOfWeek}>
        <strong>{daily ? "Every day" : days[day.dayOfWeek]}</strong><label className="venue-check"><input type="checkbox" checked={day.closed} onChange={event => patch("hours", draft.hours.map(item => daily || item.dayOfWeek === day.dayOfWeek ? { ...item, closed: event.target.checked } : item))} /> Closed</label>
        {!day.closed && <><label>Open <input type="time" value={time(day.startMinute)} onChange={event => patch("hours", draft.hours.map(item => daily || item.dayOfWeek === day.dayOfWeek ? { ...item, startMinute: parseTime(event.target.value) } : item))} /></label>
        <label>Close <input type="time" value={time(day.endMinute)} onChange={event => patch("hours", draft.hours.map(item => daily || item.dayOfWeek === day.dayOfWeek ? { ...item, endMinute: parseTime(event.target.value) + (item.endMinute >= 1440 ? 1440 : 0) } : item))} /></label>
        <label className="venue-check"><input type="checkbox" checked={day.endMinute >= 1440} onChange={event => patch("hours", draft.hours.map(item => daily || item.dayOfWeek === day.dayOfWeek ? { ...item, endMinute: item.endMinute + (event.target.checked ? 1440 : -1440) } : item))} /> Next day</label></>}
      </div>)}
      <p className="small-note">12:00 AM with “Next day” means midnight after opening. Closed days are saved without an opening range.</p>
    </div>}
    {step === 5 && <div className="venue-grid">{field("Booking interval (minutes)", String(draft.resources[0]?.bookingIntervalMinutes ?? 60), value => patch("resources", draft.resources.map(item => ({ ...item, bookingIntervalMinutes: Number(value) }))), "number")}
      {field("Minimum booking (minutes)", String(draft.resources[0]?.minimumDurationMinutes ?? 60), value => patch("resources", draft.resources.map(item => ({ ...item, minimumDurationMinutes: Number(value) }))), "number")}
      <details className="venue-advanced"><summary>Advanced: maximum duration</summary>{field("Maximum booking (minutes, optional)", String(draft.resources[0]?.maximumDurationMinutes ?? ""), value => patch("resources", draft.resources.map(item => ({ ...item, maximumDurationMinutes: value ? Number(value) : null }))), "number")}</details>
    </div>}
    {step === 6 && <div className="venue-stack">{draft.prices.map(price => <div className="venue-row" key={price.sportTypeId}><strong>{catalog.find(sport => sport.id === price.sportTypeId)?.name}</strong><label>{draft.currency} / hour <input type="number" min="0" step="0.01" value={price.amountMinor / 100} onChange={event => patch("prices", draft.prices.map(item => item.sportTypeId === price.sportTypeId ? { ...item, amountMinor: Math.round(Number(event.target.value) * 100) } : item))} /></label></div>)}<p className="small-note">These are starting rates only. Advanced pricing comes later.</p></div>}
    {step === 7 && <div className="venue-grid">{field("Business display name", draft.displayName, value => patch("displayName", value))}
      <label className="venue-field"><span>Accent color</span><input type="color" value={draft.primaryColor} onChange={event => patch("primaryColor", event.target.value)} /></label>
      <div className="venue-logo-placeholder" style={{ borderColor: draft.primaryColor }}>Logo placeholder · Uploads are not available yet</div>
    </div>}
    {step === 8 && <div className="venue-stack">{field("Your booking page address", draft.slug, value => { patch("slug", value.toLowerCase().replace(/[^a-z0-9-]/g, "-")); setAvailability(""); })}
      <p className="workspace-preview">book.productdomain.my/<strong>{draft.slug}</strong></p>
      <button type="button" className="button button-secondary" onClick={() => startTransition(async () => { const result = await checkSlugAction(draft.slug); setAvailability(result.message); })}>Check availability</button>
      <p role="status" className="small-note">{availability || "Choose an address and check availability."}</p><p className="small-note">Preview domain only. Public booking will be enabled in a later phase.</p>
    </div>}
    {step === 9 && <div className="venue-review">
      <p><strong>Venue</strong><span>{draft.displayName} · {draft.city}</span></p>
      <p><strong>Branch</strong><span>{draft.branch.name}</span></p>
      <p><strong>Sports</strong><span>{catalog.filter(sport => draft.sports.includes(sport.id)).map(sport => sport.name).join(", ")}</span></p>
      <p><strong>Courts & spaces</strong><span>{draft.resources.length}</span></p>
      <p><strong>Opening hours</strong><span>{daily ? draft.hours[0].closed ? "Closed" : `${time(draft.hours[0].startMinute)}–${time(draft.hours[0].endMinute)} daily` : "By day"}</span></p>
      <p><strong>Base pricing</strong><span>{draft.prices.map(price => `${catalog.find(sport => sport.id === price.sportTypeId)?.name}: ${draft.currency} ${(price.amountMinor / 100).toFixed(2)}/hour`).join(", ")}</span></p>
      <p><strong>Booking page</strong><span>book.productdomain.my/{draft.slug} (reserved only)</span></p>
    </div>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    <div className="setup-actions"><button type="button" className="button button-secondary" disabled={step === 0 || busy} onClick={() => { setStep(value => value - 1); setError(""); }}>Back</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={step === 9 ? finish : next}>{busy ? "Saving…" : step === 9 ? "Finish Setup" : "Continue"}</button></div>
  </div>;
}




