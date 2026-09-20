import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { staffAvailableNow } from "@/lib/booking-management";
import { bookingTime } from "@/lib/booking-format";
import { hasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Available Now" };
export default async function AvailableNowPage({ searchParams }: { searchParams: Promise<{ branchId?: string }> }) {
  const { organization, session, member } = await requirePermission("booking:view");
  const { branchId } = await searchParams;
  const data = await staffAvailableNow(getDb(), session.user.id, organization.organizationId, branchId);
  const groups = [...new Set(data.spaces.map(item => item.sportName))];
  return <div className="booking-ops-page"><header className="booking-page-head"><div><p className="eyebrow">FRONT DESK / LIVE STATUS</p><h1>Available Now</h1><p>Which courts and spaces can be used right now? Status comes from bookings, blocks and opening hours.</p></div><Link className="button button-secondary" href="/calendar">Calendar</Link></header>
    {data.branches.length > 1 && <nav className="booking-tabs" aria-label="Branch">{data.branches.map(item => <Link key={item.id} className={item.id === data.branch?.id ? "booking-tab active" : "booking-tab"} href={"/available-now?branchId=" + item.id}>{item.name}</Link>)}</nav>}
    {data.branch && <p className="booking-help">As of {bookingTime(data.at, data.branch.timezone)} · {data.branch.name} · {data.branch.timezone}. Refresh for the latest status.</p>}
    {!data.spaces.length ? <div className="booking-empty"><h2>No spaces configured</h2><p>Add courts or spaces to see live status.</p></div> : groups.map(group => <section key={group} className="booking-live-group"><h2>{group}</h2><div className="booking-live-grid">{data.spaces.filter(item => item.sportName === group).map(space => <article className="foundation-card booking-live-card" key={space.id}><div><h3>{space.name}</h3><p>{space.state === "HELD" ? `Checkout held until ${bookingTime(space.until!, data.branch!.timezone)}` : space.state === "IN_USE" ? `In use until ${bookingTime(space.until!, data.branch!.timezone)}` : space.state === "BLOCKED" ? `Blocked${space.until ? ` until ${bookingTime(space.until, data.branch!.timezone)}` : ""}` : space.state === "MAINTENANCE" ? "Maintenance" : space.state === "DISABLED" ? "Disabled" : space.state === "CLOSED" ? "Closed" : "Available"}</p>{space.reason && <small>{space.reason}</small>}</div><span className={space.state === "AVAILABLE" ? "booking-live-dot available" : "booking-live-dot"} aria-hidden />{space.state === "AVAILABLE" && hasPermission(member.role, "booking:create") && <Link className="button button-secondary" href={"/bookings/new?mode=walk-in&resourceId=" + space.id}>Walk-In</Link>}</article>)}</div></section>)}
  </div>;
}

