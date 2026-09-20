"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordManualPaymentAction, requestRefundAction } from "@/app/actions/payments";
import { bookingMoney, bookingStatusLabel } from "@/lib/booking-format";

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
  const [amount, setAmount] = useState(String(Math.max(0, (total - paid) / 100)));
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
            <RefundControl paymentId={item.id} currency={currency} refundable={refundable} onSuccess={() => router.refresh()} />}
        </div>;
      })}</div> : <p className="payment-inline-note">No payment has been recorded yet.</p>}
    {canRecord && outstanding > 0 && ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED"].includes(status) &&
      <div className="payment-manual-form"><h3>Record a payment received</h3>
        <p>Only record money the venue has actually received. This does not charge a card or move funds.</p>
        <div className="payment-form-row"><label className="venue-field">Amount ({currency})
          <input type="number" min="0.01" max={outstanding / 100} step="0.01" value={amount}
            onChange={event => setAmount(event.target.value)} /></label>
          <label className="venue-field">Method<select value={method}
            onChange={event => setMethod(event.target.value as typeof method)}>
            <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option>
            <option value="OTHER_MANUAL">Other manual</option></select></label></div>
        <button type="button" className="button button-primary" disabled={pending}
          onClick={() => startTransition(async () => {
            setError(null);
            const result = await recordManualPaymentAction({ bookingId, method,
              amountMinor: Math.round(Number(amount) * 100), idempotencyKey });
            setError(result.error);
            if (!result.error) { setIdempotencyKey(crypto.randomUUID()); router.refresh(); }
          })}>{pending ? "Recording…" : "Record payment"}</button></div>}
    {error && <p className="public-error" role="alert">{error}</p>}
    {paid > 0 && <p className="payment-inline-note">Cancellation and refunds are separate. Cancelling this booking does not return money automatically.</p>}
  </section>;
}
function RefundControl({ paymentId, currency, refundable, onSuccess }: {
  paymentId: string; currency: string; refundable: number; onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(refundable / 100));
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <div className="payment-refund">
    {!open ? <button type="button" className="text-link" onClick={() => setOpen(true)}>Record refund</button> :
      <div className="payment-refund-form"><p>{currency === "MYR" ? "Refund" : "Refund"} up to {bookingMoney(refundable, currency)}.
        For manual payments, confirm funds were returned outside Slotra before recording. Test refunds move no real money.</p>
        <label className="venue-field">Amount ({currency})<input type="number" min="0.01" max={refundable / 100}
          step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label className="venue-field">Reason (optional)<input maxLength={500} value={reason}
          onChange={event => setReason(event.target.value)} /></label>
        <div className="payment-refund-actions"><button type="button" className="button button-secondary"
          onClick={() => setOpen(false)}>Cancel</button><button type="button" className="button button-primary"
          disabled={pending} onClick={() => {
            if (!window.confirm("Confirm this refund has been issued or should be simulated?")) return;
            startTransition(async () => {
              setError(null);
              const result = await requestRefundAction({ paymentId, amountMinor: Math.round(Number(amount) * 100), reason, idempotencyKey });
              setError(result.error);
              if (!result.error) { setIdempotencyKey(crypto.randomUUID()); setOpen(false); onSuccess(); }
            });
          }}>{pending ? "Recording…" : "Confirm refund"}</button></div>
        {error && <p className="public-error" role="alert">{error}</p>}</div>}
  </div>;
}


