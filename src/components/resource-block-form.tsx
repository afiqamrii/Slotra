"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createStaffBlockAction } from "@/app/actions/bookings";
import { calendarHref } from "@/lib/calendar-presentation";

type Branch = { id: string; name: string; timezone: string };
type Space = { id: string; branchId: string; name: string; sportName: string; status: string };
export function ResourceBlockForm({ branches, spaces, initialBranchId, initialResourceId, initialDate }: {
  branches: Branch[]; spaces: Space[]; initialBranchId: string; initialResourceId: string | null; initialDate: string;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(initialBranchId);
  const [resourceId, setResourceId] = useState(initialResourceId ?? spaces.find(item => item.branchId === initialBranchId)?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [overnight, setOvernight] = useState(false);
  const [type, setType] = useState<"MANUAL" | "MAINTENANCE" | "PRIVATE_EVENT" | "OTHER">("MAINTENANCE");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();
  const saving = useRef(false);
  const [navigating, setNavigating] = useState(false);
  const locked = busy || navigating;
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await createStaffBlockAction({ branchId, resourceId, date, startTime, endTime, overnight, type, reason });
        if (result.error) { setError(result.error); saving.current = false; }
        else { setNavigating(true); router.push(calendarHref(date, "day", branchId)); }
      } catch {
        saving.current = false;
        setError("We couldn’t confirm whether the block was saved. Check the calendar before trying again.");
      }
    });
  }
  return <form className="foundation-card booking-reschedule-card" method="post" onSubmit={submit}><h2>When is this space unavailable?</h2><fieldset disabled={locked} style={{ display: "grid", gap: 18, padding: 0, margin: 0, border: 0, minWidth: 0 }}><legend className="sr-only">Space block details</legend><div className="venue-grid">
    {branches.length > 1 && <label className="venue-field"><span>Branch</span><select value={branchId} onChange={event => { const id = event.target.value; setBranchId(id); setResourceId(spaces.find(item => item.branchId === id)?.id ?? ""); }}>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label className="venue-field"><span>Court or space</span><select required value={resourceId} onChange={event => setResourceId(event.target.value)}>{spaces.filter(item => item.branchId === branchId).map(item => <option key={item.id} value={item.id}>{item.sportName} · {item.name}</option>)}</select></label>
    <label className="venue-field"><span>Date</span><input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
    <label className="venue-field"><span>Start</span><input type="time" required value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
    <label className="venue-field"><span>End</span><input type="time" required value={endTime} onChange={event => setEndTime(event.target.value)} /></label>
    <label className="venue-field"><span>Type</span><select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="MAINTENANCE">Maintenance</option><option value="PRIVATE_EVENT">Private event</option><option value="MANUAL">Manual block</option><option value="OTHER">Other</option></select></label>
  </div><label className="booking-check"><input type="checkbox" checked={overnight} onChange={event => setOvernight(event.target.checked)} />Ends the next day</label>
    <label className="venue-field"><span>Reason · optional</span><textarea rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    </fieldset>
    <p className="booking-help">Times use {branches.find(item => item.id === branchId)?.timezone}. A block cannot overlap an active booking.</p>
    {error && <p className="form-alert" role="alert">{error}</p>}<div className="booking-action-row"><button className="button button-primary" disabled={locked || !resourceId} type="submit">{locked ? "Saving…" : "Block space"}</button>{!locked && <Link className="button button-secondary" href={calendarHref(date || initialDate, "day", branchId)}>Cancel</Link>}</div>
  </form>;
}
