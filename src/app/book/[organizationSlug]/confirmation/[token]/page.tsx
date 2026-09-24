import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { CircleCheck, MapPin } from "lucide-react";
import { getDb } from "@/db/client";
import { publicConfirmation } from "@/lib/public-booking";
import { testPaymentsEnabled } from "@/lib/payment-policy";
import { TestPaymentSimulator } from "@/components/test-payment-simulator";
import { ToyyibPaymentStatus } from "@/components/toyyib-payment-status";
import { sandboxCheckoutUrl } from "@/lib/toyyibpay-sandbox";
import { CopyReference } from "./copy-reference";
import { qrSigningSecret, signBookingQr } from "@/lib/business-qr";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export const metadata: Metadata = { title: "Booking confirmation", robots: { index: false, follow: false },
  referrer: "no-referrer" };
type Props = { params: Promise<{ organizationSlug: string; token: string }> };
export default async function ConfirmationPage({ params }: Props) {
  const { organizationSlug, token } = await params;
  const booking = await publicConfirmation(getDb(), organizationSlug, token);
  if (!booking) notFound();
  const qrSecret = qrSigningSecret();
  const checkInUrl = booking.status === "CONFIRMED" && qrSecret &&
    await hasOrganizationFeature(getDb(), booking.venue.id, "QR_CHECK_IN") ?
    new URL("/check-in?code=" + encodeURIComponent(signBookingQr(booking.venue.id, booking.id,
      booking.reference, qrSecret)), process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString() : null;
  const checkInQr = checkInUrl ? await QRCode.toDataURL(checkInUrl, { width: 220, margin: 2 }) : null;
  const date = new Intl.DateTimeFormat(booking.venue.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: booking.venue.timezone }).format(booking.startAt);
  const time = (value: Date) => new Intl.DateTimeFormat(booking.venue.locale, { hour: "numeric", minute: "2-digit",
    hour12: true, timeZone: booking.venue.timezone }).format(value);
  const amount = (value: number) => new Intl.NumberFormat(booking.venue.locale, { style: "currency",
    currency: booking.currency }).format(value / 100);
  const waiting = booking.status === "AWAITING_PAYMENT" && !!booking.holdExpiresAt && booking.holdExpiresAt > new Date();
  const expired = booking.status === "EXPIRED" || (booking.status === "AWAITING_PAYMENT" && !waiting);
  const paid = booking.amountPaid;
  const remaining = Math.max(0, booking.totalAmount - paid);
  const latest = booking.paymentHistory.at(-1);
  const paymentLabel = expired ? "Checkout expired — this time is no longer reserved" :
    waiting ? "Waiting for payment confirmation" :
    paid >= booking.totalAmount ? "Paid in full" :
    paid > 0 ? "Deposit paid · " + amount(remaining) + " remaining" :
    booking.paymentHistory.some(item => item.status === "REFUNDED") ? "Payment refunded — contact the venue about this booking" :
    booking.status === "CONFIRMED" ? "Pay at venue · " + amount(remaining) + " due" : "No payment received";
  const heading = waiting ? latest?.provider === "TOYYIBPAY_SANDBOX" ? "Complete your test payment" : "Finish your test checkout" : expired ? "Checkout expired" :
    booking.status === "CONFIRMED" ? "You’re all set." : "Your booking details";
  return <div className="public-page">
    <header className="public-header"><div className="public-shell public-header-inner">
      <Link className="public-identity" href={"/book/" + booking.venue.slug}>
        <span aria-hidden="true" className="public-identity-mark">{booking.venue.name.slice(0, 2).toUpperCase()}</span>
        <span>{booking.venue.name}</span>
      </Link></div></header>
    <main id="main-content" className="public-confirm-main"><div className="public-confirm-card">
      <div className="public-confirm-icon"><CircleCheck size={30} /></div>
      <p className="public-eyebrow">BOOKING {booking.status.replaceAll("_", " ")}</p>
      <h1>{heading}</h1>
      <p className="public-confirm-lead">{waiting ? "Your time is held briefly. It is not confirmed until verified payment arrives." :
        expired ? "The hold has ended. Choose another time, or contact the venue if you were charged." :
        paid > 0 ? "Your payment was recorded. Keep this reference for your visit." :
        booking.status === "CONFIRMED" ? "Your time is reserved. Please pay at the venue when you arrive." :
        "Here is the latest status of your booking."}</p>
      <div className="public-reference"><span>Booking reference</span><strong>{booking.reference}</strong>
        <CopyReference reference={booking.reference} /></div>
      {checkInQr && <div className="public-checkin-qr"><Image src={checkInQr} alt="QR code for staff check-in"
        width={220} height={220} unoptimized /><p>Show this code to staff when you arrive. It contains no contact details.</p></div>}
      <div className="public-confirm-details"><div><span>Venue</span><strong>{booking.venue.name}</strong></div>
        <div><span>Location</span><strong><MapPin size={15} /> {booking.venue.branchName}{booking.venue.city ? " · " + booking.venue.city : ""}</strong></div>
        <div><span>{booking.sportName}</span><strong>{booking.resourceName}</strong></div>
        <div><span>Date</span><strong>{date}</strong></div>
        <div><span>Time</span><strong>{time(booking.startAt)} – {time(booking.endAt)}</strong></div>
        <div><span>Name</span><strong>{booking.customerName}</strong></div>
        <div><span>Total</span><strong>{amount(booking.totalAmount)}</strong></div>
        {booking.requiredNowMinor > 0 && <div><span>Required now</span><strong>{amount(booking.requiredNowMinor)}</strong></div>}
        <div><span>Paid</span><strong>{amount(paid)}</strong></div>
        <div><span>Balance</span><strong>{amount(remaining)}</strong></div>
        <div><span>Payment</span><strong>{paymentLabel}</strong></div>
        <div><span>Method</span><strong>{!latest ? "Pay at venue" : latest.provider === "TEST" ? "TestProvider (no real charge)" :
          latest.provider === "TOYYIBPAY_SANDBOX" ? "ToyyibPay sandbox (no real charge)" :
          latest.method?.replaceAll("_", " ") ?? latest.provider}</strong></div>
      </div>
      {waiting && latest?.provider === "TOYYIBPAY_SANDBOX" && latest.providerPaymentId &&
        <div className="public-confirm-actions"><a className="public-primary" href={sandboxCheckoutUrl(latest.providerPaymentId)}>
          Continue to ToyyibPay test payment</a><ToyyibPaymentStatus slug={booking.venue.slug} token={token} /></div>}      {waiting && latest?.provider === "TEST" && testPaymentsEnabled() && !!process.env.TEST_PAYMENT_WEBHOOK_SECRET &&
        <TestPaymentSimulator slug={booking.venue.slug} token={token} />}
      <div className="public-confirm-actions">{booking.venue.contactPhone &&
        <a className="public-primary" href={"tel:" + booking.venue.contactPhone.replace(/[^+0-9]/g, "")}>Contact venue</a>}
        <Link className="public-secondary" href={"/book/" + booking.venue.slug}>Book another time</Link></div>
      <p className="public-review-footnote">Keep this private link to view your booking again.</p>
    </div></main>
  </div>;
}


