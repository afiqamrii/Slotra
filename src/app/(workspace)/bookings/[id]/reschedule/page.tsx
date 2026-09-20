import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingSetup, staffBookingDetail } from "@/lib/booking-management";
import { RescheduleForm } from "@/components/reschedule-form";

export const metadata: Metadata = { title: "Reschedule Booking" };
export default async function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization, session } = await requirePermission("booking:update");
  const detail = await staffBookingDetail(getDb(), session.user.id, organization.organizationId, id).catch(() => notFound());
  if (!["PENDING", "AWAITING_PAYMENT", "CONFIRMED"].includes(detail.booking.status)) notFound();
  const setup = await bookingSetup(getDb(), session.user.id, organization.organizationId, "booking:update");
  const zoned = Temporal.Instant.from(detail.booking.startAt.toISOString()).toZonedDateTimeISO(detail.timezone);
  return <div className="booking-ops-page booking-form-page"><Link className="text-link" href={"/bookings/" + id}>← Booking detail</Link>
    <header className="booking-page-head"><div><p className="eyebrow">FRONT DESK / RESCHEDULE</p><h1>Reschedule {detail.booking.bookingReference}</h1><p>Choose a new time or space. Availability and any price change are checked before saving.</p></div></header>
    <RescheduleForm id={id} resourceId={detail.booking.resourceId} branchId={detail.booking.branchId}
      spaces={setup.spaces.filter(item => item.branchId === detail.booking.branchId && item.status === "ACTIVE")}
      date={zoned.toPlainDate().toString()} time={zoned.toPlainTime().toString({ smallestUnit: "minute" })}
      durationMinutes={Math.round((detail.booking.endAt.getTime() - detail.booking.startAt.getTime()) / 60_000)}
      currency={detail.booking.currency} timezone={detail.timezone} />
  </div>;
}
