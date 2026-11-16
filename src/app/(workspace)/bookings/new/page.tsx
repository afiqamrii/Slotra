import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingSetup } from "@/lib/booking-management";
import { localDateAt } from "@/lib/booking-time";
import { BookingQuickForm } from "@/components/booking-quick-form";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { branchContext } from "@/lib/branch-context";
import { getBookingCustomer } from "@/lib/customer-service";
import { BookingError } from "@/lib/booking-availability";

export const metadata: Metadata = { title: "New Booking" };
type Params = { mode?: string; branchId?: string; resourceId?: string; date?: string; startAt?: string; customerId?: string };
export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { session, organization, member } = await requirePermission("booking:create");
  const canViewBooking = member.effectivePermissions.includes("booking:view");
  const params = await searchParams;
  const initialCustomer = params.customerId ? await getBookingCustomer(getDb(), session.user.id, organization.organizationId, params.customerId)
    .catch(error => { if (error instanceof BookingError && ["CUSTOMER_NOT_FOUND", "PERMISSION_DENIED"].includes(error.code)) notFound(); throw error; }) : null;
  const setup = await bookingSetup(getDb(), session.user.id, organization.organizationId, "booking:create");
  const selectedBranch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const selectedSpace = setup.spaces.find(space => space.id === params.resourceId);
  const branch = setup.branches.find(item => item.id === (selectedSpace?.branchId ?? params.branchId ??
    (selectedBranch.selected !== "all" ? selectedBranch.selected ?? undefined : undefined))) ?? setup.branches[0];
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDateAt(new Date(), branch?.timezone ?? "Asia/Kuala_Lumpur").toString();
  const walkIn = params.mode === "walk-in";
  const businessEnabled = await hasOrganizationFeature(getDb(), organization.organizationId, "PACKAGES");
  return <div className="booking-ops-page booking-form-page"><Link className="text-link" href={canViewBooking ? walkIn ? "/available-now" : "/bookings" : "/dashboard"}>← {canViewBooking ? walkIn ? "Available Now" : "Bookings" : "Home"}</Link>
    <header className="booking-page-head"><div><p className="eyebrow">{walkIn ? "FRONT DESK / WALK-IN" : "FRONT DESK / NEW BOOKING"}</p><h1>{walkIn ? "New Walk-In" : "New Booking"}</h1><p>{walkIn ? "Pick an available space and time, then save the walk-in." : "Choose a customer, space and available time. The total is calculated when you save."}</p></div></header>
    {branch ? <BookingQuickForm branches={setup.branches} spaces={setup.spaces} initialBranchId={branch.id} initialResourceId={selectedSpace?.id ?? null} initialDate={date} initialStartAt={params.startAt ?? null} initialCustomer={initialCustomer} walkIn={walkIn} businessEnabled={businessEnabled} canViewBooking={canViewBooking} />
      : <div className="booking-empty"><h2>Set up your venue first</h2><p>Add a branch and spaces before creating a booking.</p><Link className="button button-primary" href="/onboarding">Set up venue</Link></div>}
  </div>;
}
