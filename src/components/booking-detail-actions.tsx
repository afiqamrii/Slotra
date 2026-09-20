"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { changeBookingStatusAction } from "@/app/actions/bookings";
import { bookingMoney, bookingStatusLabel } from "@/lib/booking-format";
import type { BookingStatus } from "@/db/schema";

export function BookingDetailActions({ id, reference, customer, slotLabel, allowed, canReschedule, amountPaid, currency }: {
  id: string; reference: string; customer: string; slotLabel: string; allowed: readonly BookingStatus[];
  canReschedule: boolean; amountPaid: number; currency: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<BookingStatus | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const visible = allowed.filter(status => status !== "EXPIRED");
  function change(status: BookingStatus) {
    setError("");
    startTransition(async () => {
      const result = await changeBookingStatusAction(id, status, status === "CANCELLED" ? reason : undefined);
      if (result.error) setError(result.error);
      else { setConfirming(null); setReason(""); router.refresh(); }
    });
  }
  if (!visible.length && !canReschedule) return null;
  return <section className="foundation-card booking-action-panel"><p className="eyebrow">FRONT DESK</p><h2>Next action</h2>
    <div className="booking-action-row">{canReschedule && <Link className="button button-secondary" href={"/bookings/" + id + "/reschedule"}>Reschedule</Link>}
      {visible.map(status => <button key={status} type="button" disabled={busy} className={status === "CANCELLED" || status === "NO_SHOW" ? "button button-secondary" : "button button-primary"} onClick={() => status === "CANCELLED" || status === "NO_SHOW" ? setConfirming(status) : change(status)}>{status === "CHECKED_IN" ? "Check In" : status === "NO_SHOW" ? "Mark No-show" : bookingStatusLabel(status)}</button>)}
    </div>{error && <p className="form-alert" role="alert">{error}</p>}
    {confirming && <div className="venue-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setConfirming(null); }}><div className="venue-dialog" role="dialog" aria-modal="true" aria-label={confirming === "CANCELLED" ? "Confirm cancellation" : "Confirm no-show"}>
      <h2>{confirming === "CANCELLED" ? "Cancel this booking?" : "Mark this booking as no-show?"}</h2><p><strong>{reference}</strong> · {customer}<br />{slotLabel}</p>
      {confirming === "CANCELLED" && <><label className="venue-field"><span>Reason · optional</span><textarea rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>{amountPaid > 0 && <p className="form-alert">{bookingMoney(amountPaid, currency)} is recorded as paid. Cancelling does not issue a refund. Use the payment section to record a refund separately.</p>}</>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="setup-actions"><button type="button" className="button button-secondary" onClick={() => setConfirming(null)}>Keep booking</button><button type="button" className="button button-primary" disabled={busy} onClick={() => change(confirming)}>{busy ? "Saving…" : confirming === "CANCELLED" ? "Cancel Booking" : "Mark No-show"}</button></div>
    </div></div>}
  </section>;
}

