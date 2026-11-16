import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingSetup } from "@/lib/booking-management";
import { localDateAt } from "@/lib/booking-time";
import { ResourceBlockForm } from "@/components/resource-block-form";
import { branchContext } from "@/lib/branch-context";
import { calendarHref, normalizeCalendarQuery } from "@/lib/calendar-presentation";

export const metadata: Metadata = { title: "Block a Space" };
export default async function ResourceBlockPage({ searchParams }: { searchParams: Promise<{ branchId?: string; resourceId?: string; date?: string }> }) {
  const { organization, session } = await requirePermission("resource:manage");
  const params = await searchParams;
  const query = normalizeCalendarQuery(params);
  const setup = await bookingSetup(getDb(), session.user.id, organization.organizationId, "resource:manage");
  const selectedBranch = await branchContext(getDb(), organization.organizationId, session.user.id);
  const selected = setup.spaces.find(item => item.id === params.resourceId);
  const branch = setup.branches.find(item => item.id === (selected?.branchId ?? query.branchId ??
    (selectedBranch.selected !== "all" ? selectedBranch.selected ?? undefined : undefined))) ?? setup.branches[0];
  const date = query.date ?? localDateAt(new Date(), branch?.timezone ?? "Asia/Kuala_Lumpur").toString();
  return <div className="booking-ops-page booking-form-page"><Link className="text-link" href={calendarHref(date, "day", branch?.id)}>← Calendar</Link><header className="booking-page-head"><div><p className="eyebrow">FRONT DESK / SPACE BLOCK</p><h1>Block a space</h1><p>Use a timed block for maintenance, private events or manual closures. Existing bookings are protected.</p></div></header>
    {branch ? <ResourceBlockForm branches={setup.branches} spaces={setup.spaces} initialBranchId={branch.id} initialResourceId={selected?.id ?? null} initialDate={date} /> : <div className="booking-empty">Set up a branch first.</div>}
  </div>;
}
