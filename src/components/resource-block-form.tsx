"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStaffBlockAction } from "@/app/actions/bookings";

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
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    startTransition(async () => {
      const result = await createStaffBlockAction({ branchId, resourceId, date, startTime, endTime, overnight, type, reason });
      if (result.error) setError(result.error);
      else router.push("/calendar?date=" + date + "&branchId=" + branchId);
    });
  }
  return <form className="foundation-card booking-reschedule-card" onSubmit={submit}><h2>When is this space unavailable?</h2><div className="venue-grid">
    {branches.length > 1 && <label className="venue-field"><span>Branch</span><select value={branchId} onChange={event => { const id = event.target.value; setBranchId(id); setResourceId(spaces.find(item => item.branchId === id)?.id ?? ""); }}>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label className="venue-field"><span>Court or space</span><select required value={resourceId} onChange={event => setResourceId(event.target.value)}>{spaces.filter(item => item.branchId === branchId).map(item => <option key={item.id} value={item.id}>{item.sportName} · {item.name}</option>)}</select></label>
    <label className="venue-field"><span>Date</span><input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
    <label className="venue-field"><span>Start</span><input type="time" required value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
    <label className="venue-field"><span>End</span><input type="time" required value={endTime} onChange={event => setEndTime(event.target.value)} /></label>
    <label className="venue-field"><span>Type</span><select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="MAINTENANCE">Maintenance</option><option value="PRIVATE_EVENT">Private event</option><option value="MANUAL">Manual block</option><option value="OTHER">Other</option></select></label>
  </div><label className="booking-check"><input type="checkbox" checked={overnight} onChange={event => setOvernight(event.target.checked)} />Ends the next day</label>
    <label className="venue-field"><span>Reason · optional</span><textarea rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <p className="booking-help">Times use {branches.find(item => item.id === branchId)?.timezone}. A block cannot overlap an active booking.</p>
    {error && <p className="form-alert" role="alert">{error}</p>}<button className="button button-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Block space"}</button>
  </form>;
}
