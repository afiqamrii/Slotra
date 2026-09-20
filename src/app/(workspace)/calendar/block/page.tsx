import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingSetup } from "@/lib/booking-management";
import { localDateAt } from "@/lib/booking-time";
import { ResourceBlockForm } from "@/components/resource-block-form";

export const metadata: Metadata = { title: "Block a Space" };
export default async function ResourceBlockPage({ searchParams }: { searchParams: Promise<{ branchId?: string; resourceId?: string; date?: string }> }) {
  const { organization, session } = await requirePermission("resource:manage");
  const params = await searchParams;
  const setup = await bookingSetup(getDb(), session.user.id, organization.organizationId, "resource:manage");
  const selected = setup.spaces.find(item => item.id === params.resourceId);
  const branch = setup.branches.find(item => item.id === (selected?.branchId ?? params.branchId)) ?? setup.branches[0];
  return <div className="booking-ops-page booking-form-page"><Link className="text-link" href="/calendar">← Calendar</Link><header className="booking-page-head"><div><p className="eyebrow">FRONT DESK / SPACE BLOCK</p><h1>Block a space</h1><p>Use a timed block for maintenance, private events or manual closures. Existing bookings are protected.</p></div></header>
    {branch ? <ResourceBlockForm branches={setup.branches} spaces={setup.spaces} initialBranchId={branch.id} initialResourceId={selected?.id ?? null} initialDate={params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDateAt(new Date(), branch.timezone).toString()} /> : <div className="booking-empty">Set up a branch first.</div>}
  </div>;
}
