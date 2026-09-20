import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { staffBookingDetail } from "@/lib/booking-management";
import { allowedBookingTransitions } from "@/lib/booking-service";
import { bookingDate, bookingMoney, bookingStatusLabel, bookingTime } from "@/lib/booking-format";
import { hasPermission } from "@/lib/permissions";
import type { BookingStatus } from "@/db/schema";
import { StatusBadge } from "@/components/ui";
import { BookingDetailActions } from "@/components/booking-detail-actions";
import { BookingPaymentSection } from "@/components/booking-payment-section";
import { paymentHistory } from "@/lib/payment-service";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export const metadata: Metadata = { title: "Booking Detail" };
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization, session, member } = await requirePermission("booking:view");
  const row = await staffBookingDetail(getDb(), session.user.id, organization.organizationId, id).catch(() => notFound());
  const booking = row.booking;
  const [finance, onlineRefundAllowed] = await Promise.all([
    paymentHistory(getDb(), session.user.id, organization.organizationId, id),
    hasOrganizationFeature(getDb(), organization.organizationId, "ONLINE_REFUNDS"),
  ]);
  const allowed = (allowedBookingTransitions[booking.status as BookingStatus] ?? []).filter(status =>
    !(status === "CONFIRMED" && booking.requiredNowMinor > booking.amountPaid) &&
    hasPermission(member.role, status === "CANCELLED" ? "booking:cancel" : status === "CHECKED_IN" ? "booking:check_in" : "booking:update"));
  const canReschedule = ["PENDING", "CONFIRMED"].includes(booking.status) && hasPermission(member.role, "booking:update");
  const duration = Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60_000);
  const slotLabel = bookingDate(booking.startAt, row.timezone, true) + " · " + bookingTime(booking.startAt, row.timezone) + " – " + bookingTime(booking.endAt, row.timezone);
  return <div className="booking-ops-page booking-detail-page"><Link className="text-link" href="/bookings">← Bookings</Link>
    <header className="booking-page-head"><div><p className="eyebrow">BOOKING DETAIL</p><h1>{booking.bookingReference}</h1><p>{row.sportName} · {row.resourceName} · {row.branchName}</p></div><StatusBadge label={bookingStatusLabel(booking.status)} tone={booking.status === "CONFIRMED" || booking.status === "CHECKED_IN" ? "success" : booking.status === "CANCELLED" || booking.status === "NO_SHOW" ? "warning" : "neutral"} /></header>
    <div className="booking-detail-grid"><section className="foundation-card"><p className="eyebrow">RESERVATION</p><h2>Session details</h2><dl className="booking-detail-list"><div><dt>Customer</dt><dd>{row.customer?.name ?? "Guest / walk-in"}</dd></div><div><dt>Phone</dt><dd>{row.customer?.phone ?? "Not provided"}</dd></div><div><dt>Email</dt><dd>{row.customer?.email ?? "Not provided"}</dd></div><div><dt>Sport</dt><dd>{row.sportName}</dd></div><div><dt>Branch</dt><dd>{row.branchName}</dd></div><div><dt>Court or space</dt><dd>{row.resourceName}</dd></div><div><dt>Date</dt><dd>{bookingDate(booking.startAt, row.timezone, true)}</dd></div><div><dt>Time</dt><dd>{bookingTime(booking.startAt, row.timezone)} – {bookingTime(booking.endAt, row.timezone)} <small>({row.timezone})</small></dd></div><div><dt>Duration</dt><dd>{duration} minutes</dd></div><div><dt>Source</dt><dd>{bookingStatusLabel(booking.source)}</dd></div><div><dt>Created</dt><dd>{bookingDate(booking.createdAt, row.timezone)} · {bookingTime(booking.createdAt, row.timezone)}</dd></div><div><dt>Notes</dt><dd>{booking.notes || "—"}</dd></div></dl></section>
      <section className="foundation-card"><p className="eyebrow">CHARGES</p><h2>Booking total</h2><dl className="booking-detail-list"><div><dt>Subtotal</dt><dd>{bookingMoney(booking.subtotal, booking.currency)}</dd></div><div><dt>Discount</dt><dd>{bookingMoney(booking.discountAmount, booking.currency)}</dd></div><div><dt>Tax</dt><dd>{bookingMoney(booking.taxAmount, booking.currency)}</dd></div><div className="booking-total-row"><dt>Total</dt><dd>{bookingMoney(booking.totalAmount, booking.currency)}</dd></div><div><dt>Paid</dt><dd>{bookingMoney(booking.amountPaid, booking.currency)}</dd></div><div><dt>Outstanding</dt><dd>{bookingMoney(booking.totalAmount - booking.amountPaid, booking.currency)}</dd></div></dl><p className="booking-help">Amounts are stored in minor currency units and updated from verified or staff-recorded payments.</p></section></div>
    <BookingPaymentSection bookingId={booking.id} currency={booking.currency} status={booking.status}
      total={booking.totalAmount} paid={booking.amountPaid} requiredNow={booking.requiredNowMinor}
      holdExpiresAt={booking.holdExpiresAt} payments={finance.payments} refunds={finance.refunds}
      canRecord={hasPermission(member.role, "payment:record_manual")}
      canRefund={hasPermission(member.role, "payment:refund")} canRefundOnline={onlineRefundAllowed} />
    <BookingDetailActions id={booking.id} reference={booking.bookingReference} customer={row.customer?.name ?? "Guest / walk-in"} slotLabel={slotLabel} allowed={allowed} canReschedule={canReschedule} amountPaid={booking.amountPaid} currency={booking.currency} />
  </div>;
}

