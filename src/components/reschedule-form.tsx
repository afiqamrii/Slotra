"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quoteRescheduleAction, rescheduleStaffBookingAction } from "@/app/actions/bookings";
import { bookingMoney } from "@/lib/booking-format";

type Space = { id: string; name: string; sportName: string; bookingIntervalMinutes: number; minimumDurationMinutes: number; maximumDurationMinutes: number | null };
export function RescheduleForm({ id, resourceId: initialResource, spaces, date: initialDate, time: initialTime,
  durationMinutes: initialDuration, currency, timezone }: {
  id: string; resourceId: string; branchId: string; spaces: Space[]; date: string; time: string;
  durationMinutes: number; currency: string; timezone: string;
}) {
  const router = useRouter();
  const [resourceId, setResourceId] = useState(initialResource);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [durationMinutes, setDuration] = useState(initialDuration);
  const [quote, setQuote] = useState<{ currentTotal: number; newTotal: number; currency: string; priceChanged: boolean; bookingUpdatedAt: string } | null>(null);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<"check" | "save">("check");
  const [busy, startTransition] = useTransition();
  const working = useRef(false);
  const space = spaces.find(item => item.id === resourceId);
  const input = { resourceId, date, time, durationMinutes };
  function change() { setQuote(null); setError(""); }
  function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working.current || busy) return;
    working.current = true;
    setIntent("check"); setQuote(null); setError(""); startTransition(async () => {
      try {
        const result = await quoteRescheduleAction(id, input);
        setQuote(result.quote); setError(result.error ?? "");
      } catch { setError("Could not check this slot. Please try again."); }
      finally { working.current = false; }
    });
  }
  function save() {
    if (!quote || busy || working.current) return;
    working.current = true;
    setIntent("save"); setError(""); startTransition(async () => {
      try {
        const result = await rescheduleStaffBookingAction(id, { ...input, expectedTotalMinor: quote.newTotal,
          expectedBookingUpdatedAt: quote.bookingUpdatedAt });
        if (result.error) { setQuote(null); setError(result.error); }
        else router.push("/bookings/" + id);
      } catch {
        setQuote(null);
        setError("Could not confirm whether the change was saved. Check the booking before trying again.");
      } finally { working.current = false; }
    });
  }
  return <form method="post" onSubmit={check} aria-busy={busy} className="foundation-card booking-reschedule-card"><h2>New booking slot</h2><p className="booking-help">Times shown in {timezone}. The final save checks the slot again.</p>
    <div className="venue-grid">
      <label className="venue-field"><span>Court or space</span><select disabled={busy} value={resourceId} onChange={event => { setResourceId(event.target.value); change(); }}>{spaces.map(item => <option key={item.id} value={item.id}>{item.sportName} · {item.name}</option>)}</select></label>
      <label className="venue-field"><span>Date</span><input required disabled={busy} type="date" value={date} onChange={event => { setDate(event.target.value); change(); }} /></label>
      <label className="venue-field"><span>Start time</span><input required disabled={busy} type="time" value={time} onChange={event => { setTime(event.target.value); change(); }} /></label>
      <label className="venue-field"><span>Duration · minutes</span><input required disabled={busy} type="number" min={space?.minimumDurationMinutes ?? 1} max={space?.maximumDurationMinutes ?? 1440} step={space?.bookingIntervalMinutes ?? 1} value={durationMinutes} onChange={event => { setDuration(Number(event.target.value)); change(); }} /></label>
    </div>
    {quote && <div className="booking-quote"><strong>{quote.priceChanged ? "Price change" : "Price unchanged"}</strong><span>{bookingMoney(quote.currentTotal, currency)} → {bookingMoney(quote.newTotal, quote.currency)}</span></div>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    <div className="setup-actions"><button type="submit" className="button button-secondary" disabled={busy || !space || !date || !time}>{busy && intent === "check" ? "Checking…" : "Check availability & price"}</button><button type="button" className="button button-primary" disabled={busy || !quote} onClick={save}>{busy && intent === "save" ? "Saving…" : "Save new slot"}</button></div>
  </form>;
}
