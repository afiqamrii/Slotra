"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { recordManualPaymentAction, requestRefundAction } from "@/app/actions/payments";
import { bookingMoney, bookingStatusLabel } from "@/lib/booking-format";
import { ModalDialog } from "@/components/modal-dialog";

type PaymentRow = { id: string; provider: string; amountMinor: number; status: string;
  paymentMethod: string | null; paidAt: Date | null };
type RefundRow = { id: string; paymentId: string; amountMinor: number; status: string; reason: string | null };
export function BookingPaymentSection({ bookingId, currency, status, total, paid, requiredNow, holdExpiresAt,
  payments, refunds, canRecord, canRefund, canRefundOnline }: {
  bookingId: string; currency: string; status: string; total: number; paid: number;
  requiredNow: number; holdExpiresAt: Date | null;
  payments: PaymentRow[]; refunds: RefundRow[]; canRecord: boolean; canRefund: boolean; canRefundOnline: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<string | null>(null);
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER" | "OTHER_MANUAL">("CASH");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const outstanding = total - paid;
  return <section className="foundation-card payment-booking-section">
    <p className="eyebrow">PAYMENTS</p><h2>Payment & balance</h2>
    <div className="payment-totals"><div><span>Total</span><strong>{bookingMoney(total, currency)}</strong></div>
      <div><span>Paid</span><strong>{bookingMoney(paid, currency)}</strong></div>
      <div><span>Outstanding</span><strong>{bookingMoney(outstanding, currency)}</strong></div></div>
    {status === "AWAITING_PAYMENT" && <p className="payment-inline-note">Waiting for verified online payment of {bookingMoney(requiredNow, currency)}.
      {holdExpiresAt && " Hold expires " + new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(holdExpiresAt) + "."}
      Staff cannot confirm this booking from a browser return.</p>}
    {payments.length ? <div className="payment-history"><h3>Payment history</h3>
      {payments.map(item => {
        const used = refunds.filter(refund => refund.paymentId === item.id && refund.status !== "FAILED")
          .reduce((sum, refund) => sum + refund.amountMinor, 0);
        const refundable = item.amountMinor - used;
        return <div className="payment-history-row" key={item.id}>
          <div><strong>{bookingMoney(item.amountMinor, currency)}</strong>
            <span>{item.provider === "TEST" ? "Test payment (no real money)" :
              item.provider === "TOYYIBPAY_SANDBOX" ? "ToyyibPay sandbox (no real money)" :
              bookingStatusLabel(item.paymentMethod || item.provider)} · {bookingStatusLabel(item.status)}</span></div>
          {refunds.filter(refund => refund.paymentId === item.id).map(refund =>
            <small key={refund.id}>Refund {bookingMoney(refund.amountMinor, currency)} · {bookingStatusLabel(refund.status)}</small>)}
          {canRefund && (item.provider === "MANUAL" || canRefundOnline) && item.provider !== "TOYYIBPAY_SANDBOX" && refundable > 0 && ["PAID", "PARTIALLY_REFUNDED"].includes(item.status) &&
            <RefundControl paymentId={item.id} provider={item.provider} currency={currency} refundable={refundable} onSuccess={() => router.refresh()} />}
        </div>;
      })}</div> : <p className="payment-inline-note">No payment has been recorded yet.</p>}
    {canRecord && outstanding > 0 && ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"].includes(status) &&
      <form className="payment-manual-form" method="post" onSubmit={event => {
        event.preventDefault();
        if (pending) return;
        startTransition(async () => {
          setError(null);
          const result = await recordManualPaymentAction({ bookingId, method,
            amountMinor: Math.round(Number(amount ?? outstanding / 100) * 100), idempotencyKey });
          setError(result.error);
          if (!result.error) { setAmount(null); setIdempotencyKey(crypto.randomUUID()); router.refresh(); }
        });
      }}><h3>Record a payment received</h3>
        <p>Only record money the venue has actually received. This does not charge a card or move funds.</p>
        <div className="payment-form-row"><label className="venue-field">Amount ({currency})
          <input disabled={pending} required type="number" min="0.01" max={outstanding / 100} step="0.01" value={amount ?? String(outstanding / 100)}
            onChange={event => setAmount(event.target.value)} /></label>
          <label className="venue-field">Method<select disabled={pending} value={method}
            onChange={event => setMethod(event.target.value as typeof method)}>
            <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option>
            <option value="OTHER_MANUAL">Other manual</option></select></label></div>
        <button type="submit" className="button button-primary" disabled={pending}
          >{pending ? "Recording…" : "Record payment"}</button></form>}
    {error && <p className="public-error" role="alert">{error}</p>}
    {paid > 0 && <p className="payment-inline-note">Cancellation and refunds are separate. Cancelling this booking does not return money automatically.</p>}
  </section>;
}
function RefundControl({ paymentId, provider, currency, refundable, onSuccess }: {
  paymentId: string; provider: string; currency: string; refundable: number; onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(refundable / 100));
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [unsettled, setUnsettled] = useState(false);
  const manual = provider === "MANUAL";
  const simulated = provider === "TEST";
  const actionLabel = manual ? "Record refund" : simulated ? "Simulate refund" : "Request refund";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      setError(null);
      const result = await requestRefundAction({ paymentId, amountMinor: Math.round(Number(amount) * 100), reason, idempotencyKey });
      setError(result.error);
      if (result.refundStatus === "FAILED") { setIdempotencyKey(crypto.randomUUID()); setUnsettled(false); }
      else if (result.refundStatus === "PENDING" || result.refundStatus === "PROCESSING") setUnsettled(true);
      else if (!result.error) { setIdempotencyKey(crypto.randomUUID()); setUnsettled(false); setOpen(false); onSuccess(); }
    });
  }
  return <div className="payment-refund">
    <button type="button" className="text-link" onClick={() => {
      if (!unsettled) { setAmount(String(refundable / 100)); setReason(""); setError(null); }
      setOpen(true);
    }}>{actionLabel}</button>
    {open && <ModalDialog label={actionLabel} busy={pending} onClose={() => setOpen(false)}>
      <h2>{actionLabel}</h2>
      <p>Up to {bookingMoney(refundable, currency)} is available to refund.</p>
      <p>{manual ? "Only record money already returned to the customer outside Slotra. This updates the ledger and does not transfer funds."
        : simulated ? "This simulates a test refund. No real money moves."
        : "This requests a refund from the connected payment provider."}</p>
      <form className="payment-refund-form" method="post" onSubmit={submit}>
        <label className="venue-field">Amount ({currency})<input disabled={pending || unsettled} required type="number" min="0.01" max={refundable / 100}
          step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label className="venue-field">Reason (optional)<input disabled={pending || unsettled} maxLength={500} value={reason}
          onChange={event => setReason(event.target.value)} /></label>
        {manual && <label className="venue-check"><input disabled={pending || unsettled} required type="checkbox" /> I confirm this money has already been returned to the customer.</label>}
        <div className="payment-refund-actions"><button type="button" className="button button-secondary"
          disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="button button-primary"
          disabled={pending}>{pending ? "Recording…" : unsettled ? "Check refund status" : actionLabel}</button></div>
        {error && <p className="public-error" role="alert">{error}</p>}</form>
    </ModalDialog>}
  </div>;
}


