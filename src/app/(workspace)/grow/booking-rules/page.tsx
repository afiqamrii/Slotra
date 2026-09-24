import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { getBusinessPolicy } from "@/lib/business-rules";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { updateBusinessPolicyAction } from "../actions";

export const metadata: Metadata = { title: "Booking Rules" };
export default async function BookingRulesPage({ searchParams }: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { organization, member } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "ADVANCED_BOOKING_RULES")) redirect("/grow");
  const [policy, params] = await Promise.all([getBusinessPolicy(db, orgId), searchParams]);
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / BOOKING RULES</p><h1>Booking rules</h1>
    <p className="foundation-lead">A few venue-wide safeguards. Leave a field empty to use each space’s normal setting.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {params.saved && <p className="pro-success" role="status">Booking rules saved.</p>}
    {hasPermission(member.role, "organization:update") && <section className="foundation-card grow-form-card">
      <h2>Before a booking</h2><form action={updateBusinessPolicyAction} className="grow-form">
        <div className="grow-form-pair"><label>Minimum notice · minutes<input name="minimumNoticeMinutes" type="number" min="0" max="10080" defaultValue={policy?.minimumNoticeMinutes ?? ""} placeholder="Space default" /></label>
          <label>Book up to · days ahead<input name="maximumAdvanceDays" type="number" min="1" max="365" defaultValue={policy?.maximumAdvanceDays ?? ""} placeholder="Space default" /></label></div>
        <div className="grow-form-pair"><label>Longest booking · minutes<input name="maximumDurationMinutes" type="number" min="30" max="1440" defaultValue={policy?.maximumDurationMinutes ?? ""} placeholder="Space default" /></label>
          <label>Buffer between bookings · minutes<input name="bookingBufferMinutes" type="number" min="0" max="180" required defaultValue={policy?.bookingBufferMinutes ?? 0} /></label></div>
        <h2>Changes and cancellations</h2>
        <div className="grow-form-pair"><label>Cancellation cutoff · minutes before start<input name="cancellationCutoffMinutes" type="number" min="0" max="10080" defaultValue={policy?.cancellationCutoffMinutes ?? ""} placeholder="No cutoff" /></label>
          <label>Reschedule cutoff · minutes before start<input name="rescheduleCutoffMinutes" type="number" min="0" max="10080" defaultValue={policy?.rescheduleCutoffMinutes ?? ""} placeholder="No cutoff" /></label></div>
        <p className="grow-form-help">The shared availability and booking services enforce these rules. Cancellation does not automatically issue a refund.</p>
        <button className="button button-primary" type="submit">Save rules</button></form></section>}
  </div>;
}
