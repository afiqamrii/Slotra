"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock3, RefreshCw, Search, Shield } from "lucide-react";
import { filterLiveSpaces, spaceStatusGroup, type SpaceStatusFilter } from "@/lib/live-space-filters";
import { bookingTime } from "@/lib/booking-format";
import "./available-now-board.css";

type Space = { id: string; name: string; sportName: string; state: string; until: string | null; reason: string | null };
const statusLabels: Record<string, string> = { AVAILABLE: "Available now", IN_USE: "In use", HELD: "Checkout hold", BLOCKED: "Blocked", MAINTENANCE: "Maintenance", DISABLED: "Disabled", CLOSED: "Closed" };

export function AvailableNowBoard({ spaces, branchId, branchName, branchActive, timezone, at, canCreate }: {
  spaces: Space[]; branchId: string; branchName: string; branchActive: boolean; timezone: string; at: string; canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SpaceStatusFilter>("all");
  const counts = { available: 0, occupied: 0, unavailable: 0 };
  for (const space of spaces) counts[spaceStatusGroup(space.state)]++;
  const visible = filterLiveSpaces(spaces, query, status);
  const sports = [...new Set(visible.map(space => space.sportName))];
  return <div className="live-space-board" aria-busy={pending}>
    <div className="live-status-summary">
      <button type="button" className={status === "available" ? "live-status-tile selected" : "live-status-tile"} aria-pressed={status === "available"} onClick={() => setStatus(status === "available" ? "all" : "available")}><Check size={18} aria-hidden /><span><strong>{counts.available}</strong> Available now</span><small>Open and unoccupied</small></button>
      <button type="button" className={status === "occupied" ? "live-status-tile selected" : "live-status-tile"} aria-pressed={status === "occupied"} onClick={() => setStatus(status === "occupied" ? "all" : "occupied")}><Clock3 size={18} aria-hidden /><span><strong>{counts.occupied}</strong> In use or held</span><small>Bookings and checkout holds</small></button>
      <button type="button" className={status === "unavailable" ? "live-status-tile selected" : "live-status-tile"} aria-pressed={status === "unavailable"} onClick={() => setStatus(status === "unavailable" ? "all" : "unavailable")}><Shield size={18} aria-hidden /><span><strong>{counts.unavailable}</strong> Unavailable</span><small>Closed, blocked or inactive</small></button>
    </div>
    <section className="live-spaces-panel" aria-label="Current space status">
      <div className="live-space-controls"><label className="live-space-search"><Search size={18} aria-hidden /><span className="sr-only">Search spaces or sports</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a space or sport" maxLength={100} /></label>
        <label className="live-state-select"><span className="sr-only">Filter by availability</span><select value={status} onChange={event => setStatus(event.target.value as SpaceStatusFilter)}><option value="all">All spaces</option><option value="available">Available now</option><option value="occupied">In use or held</option><option value="unavailable">Unavailable</option></select></label>
        <button className="button button-secondary" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw size={16} aria-hidden className={pending ? "live-refresh-spinning" : ""} />{pending ? "Refreshing…" : "Refresh status"}</button></div>
      <div className="live-space-context"><span>{branchName} · {timezone}</span><span role="status">{pending ? "Checking the latest status…" : `Updated ${bookingTime(at, timezone)} · ${visible.length} of ${spaces.length} spaces`}</span></div>
      {!branchActive && <p className="live-space-footnote">This branch is inactive. Its spaces cannot accept new bookings.</p>}
      {!visible.length ? <div className="booking-empty"><Search size={27} aria-hidden /><h2>{spaces.length ? "No spaces match" : "No spaces configured"}</h2><p>{spaces.length ? "Try another name or show all space statuses." : "Add courts or spaces to see their current status."}</p>{spaces.length > 0 && <button className="button button-secondary" type="button" onClick={() => { setQuery(""); setStatus("all"); }}>Show all spaces</button>}</div> :
        sports.map(sport => <section key={sport} className="live-sport-section"><h2>{sport}<span>{visible.filter(space => space.sportName === sport).length} spaces</span></h2><div className="live-space-grid">{visible.filter(space => space.sportName === sport).map(space => {
          const group = spaceStatusGroup(space.state);
          return <article className={"live-space-card " + group} key={space.id}><div className="live-space-card-top"><h3>{space.name}</h3><span className="live-state-badge">{statusLabels[space.state] ?? "Unavailable"}</span></div>
            <p>{!branchActive ? "Branch is inactive." : space.until && ["HELD", "IN_USE", "BLOCKED"].includes(space.state) ? `${space.state === "HELD" ? "Hold expires" : space.state === "IN_USE" ? "Current booking ends" : "Block ends"} at ${bookingTime(space.until, timezone)}` : space.state === "AVAILABLE" ? "Check a session time to book this space." : space.state === "CLOSED" ? "Outside current opening hours." : "This space is not accepting bookings right now."}</p>
            {space.reason && <small className="live-space-reason">{space.reason}</small>}
            <div className="live-space-actions">{group === "available" && canCreate ? <Link className="button button-primary" href={"/bookings/new?" + new URLSearchParams({ mode: "walk-in", branchId, resourceId: space.id })}>Check walk-in times</Link> : <Link className="text-link" href={"/calendar?" + new URLSearchParams({ branchId, view: "agenda" })}>View schedule</Link>}</div>
          </article>;
        })}</div></section>)}
      <p className="live-space-footnote">This is a status snapshot, not a reservation. Availability for the full session is checked before you book.</p>
    </section>
  </div>;
}
