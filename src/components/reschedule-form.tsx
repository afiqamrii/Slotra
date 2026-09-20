"use client";

import { useState, useTransition } from "react";
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
  const [quote, setQuote] = useState<{ currentTotal: number; newTotal: number; currency: string; priceChanged: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const space = spaces.find(item => item.id === resourceId);
  const input = { resourceId, date, time, durationMinutes };
  function change() { setQuote(null); setError(""); }
  function check() {
    setError(""); startTransition(async () => {
      const result = await quoteRescheduleAction(id, input);
      setQuote(result.quote); setError(result.error ?? "");
    });
  }
  function save() {
    if (!quote) return;
    setError(""); startTransition(async () => {
      const result = await rescheduleStaffBookingAction(id, input);
      if (result.error) { setQuote(null); setError(result.error); }
      else router.push("/bookings/" + id);
    });
  }
  return <section className="foundation-card booking-reschedule-card"><h2>New booking slot</h2><p className="booking-help">Times shown in {timezone}. The final save checks the slot again.</p>
    <div className="venue-grid">
      <label className="venue-field"><span>Court or space</span><select value={resourceId} onChange={event => { setResourceId(event.target.value); change(); }}>{spaces.map(item => <option key={item.id} value={item.id}>{item.sportName} · {item.name}</option>)}</select></label>
      <label className="venue-field"><span>Date</span><input type="date" value={date} onChange={event => { setDate(event.target.value); change(); }} /></label>
      <label className="venue-field"><span>Start time</span><input type="time" value={time} onChange={event => { setTime(event.target.value); change(); }} /></label>
      <label className="venue-field"><span>Duration · minutes</span><input type="number" min={space?.minimumDurationMinutes ?? 1} max={space?.maximumDurationMinutes ?? 1440} step={space?.bookingIntervalMinutes ?? 1} value={durationMinutes} onChange={event => { setDuration(Number(event.target.value)); change(); }} /></label>
    </div>
    {quote && <div className="booking-quote"><strong>{quote.priceChanged ? "Price change" : "Price unchanged"}</strong><span>{bookingMoney(quote.currentTotal, currency)} → {bookingMoney(quote.newTotal, quote.currency)}</span></div>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    <div className="setup-actions"><button type="button" className="button button-secondary" disabled={busy || !space || !date || !time} onClick={check}>{busy ? "Checking…" : "Check availability & price"}</button><button type="button" className="button button-primary" disabled={busy || !quote} onClick={save}>{busy ? "Saving…" : "Save new slot"}</button></div>
  </section>;
}
