import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { branches, customers, resources } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { BookingError } from "@/lib/booking-availability";
import { resolveBookingQr } from "@/lib/business-qr";
import { hasPermission } from "@/lib/permissions";
import { checkInQrAction } from "./actions";

export const metadata: Metadata = { title: "QR Check-in", robots: { index: false, follow: false },
  referrer: "no-referrer" };
export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const { session, organization, member } = await requirePermission("booking:view");
  const params = await searchParams;
  let detail: { id: string; reference: string; status: string; customer: string | null; space: string;
    startAt: Date; endAt: Date; timezone: string } | null = null;
  let error: string | null = params.error ? "Check-in could not be completed. The booking may have changed." : null;
  if (params.code) {
    try {
      const booking = await resolveBookingQr(getDb(), session.user.id, organization.organizationId, params.code);
      const [row] = await getDb().select({ customer: customers.name, space: resources.name,
        timezone: branches.timezone }).from(resources)
        .innerJoin(branches, and(eq(branches.organizationId, organization.organizationId),
          eq(branches.id, resources.branchId)))
        .leftJoin(customers, and(eq(customers.organizationId, organization.organizationId), sql`${customers.id} = ${booking.customerId}`))
        .where(and(eq(resources.organizationId, organization.organizationId), eq(resources.id, booking.resourceId))).limit(1);
      detail = { id: booking.id, reference: booking.bookingReference, status: booking.status,
        customer: row?.customer ?? null, space: row?.space ?? "Space", timezone: row?.timezone ?? "Asia/Kuala_Lumpur",
        startAt: booking.startAt, endAt: booking.endAt };
    } catch (caught) {
      error = caught instanceof BookingError && caught.code === "PLAN_FEATURE_UNAVAILABLE" ?
        "QR check-in is available on Business." : "This check-in code is invalid or belongs to another venue.";
    }
  }
  const canCheckIn = detail?.status === "CONFIRMED" && hasPermission(member.role, "booking:check_in");
  return <div className="foundation-page grow-page"><Link className="text-link" href="/bookings">← Bookings</Link>
    <p className="eyebrow">FRONT DESK</p><h1>QR check-in</h1>
    <p className="foundation-lead">Scan the guest’s QR with your phone camera to open this screen, or paste the check-in code below.</p>
    <form action="/check-in" method="get" className="foundation-card grow-form-card grow-form">
      <label>Check-in code<input name="code" required maxLength={110} defaultValue={params.code ?? ""} /></label>
      <button className="button button-secondary" type="submit">Find booking</button></form>
    {error && <p className="pro-error" role="alert">{error}</p>}
    {detail && <section className="foundation-card grow-list-card"><h2>{detail.reference}</h2>
      <p>{detail.customer ?? "Guest"} · {detail.space}</p><p>{detail.startAt.toLocaleString("en-MY", {
        dateStyle: "medium", timeStyle: "short", timeZone: detail.timezone })}</p>
      <p>Status: {detail.status.replaceAll("_", " ")}</p>
      {canCheckIn ? <form action={checkInQrAction}><input type="hidden" name="code" value={params.code} />
        <button className="button button-primary" type="submit">Check in guest</button></form> :
        <p className="grow-form-help">Check-in is available only for confirmed bookings and authorized staff.</p>}
      <Link className="text-link" href={"/bookings/" + detail.id}>View booking</Link></section>}
  </div>;
}
