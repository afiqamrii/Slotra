"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resourceStatusAction, saveBranchAction, saveResourceAction } from "@/app/actions/venue";
type Branch = { id: string; name: string; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postcode: string | null; country: string; timezone: string; isActive: boolean };
type Sport = { id: string; name: string };
type Space = { id: string; name: string; sportTypeId: string; branchId: string; status: string; bookingIntervalMinutes: number; minimumDurationMinutes: number; maximumDurationMinutes: number | null };
export function BranchEditor({ initial, canEdit }: { initial: Branch; canEdit: boolean }) {
  const router = useRouter(); const [value, setValue] = useState(initial); const [error, setError] = useState(""); const [busy, start] = useTransition();
  return <form className="venue-stack" onSubmit={event => { event.preventDefault(); start(async () => { const result = await saveBranchAction(value); setError(result.error ?? ""); if (!result.error) router.refresh(); }); }}>
    <div className="venue-grid">{(["name", "addressLine1", "addressLine2", "city", "state", "postcode", "country", "timezone"] as const).map(key =>
      <label className="venue-field" key={key}><span>{({ name: "Branch name", addressLine1: "Address", addressLine2: "Address line 2", city: "City", state: "State", postcode: "Postcode", country: "Country code", timezone: "Timezone" })[key]}</span><input disabled={!canEdit} value={value[key] ?? ""} onChange={event => setValue(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
    <label className="venue-check"><input disabled={!canEdit} type="checkbox" checked={value.isActive} onChange={event => setValue(current => ({ ...current, isActive: event.target.checked }))} /> Active branch</label>
    {error && <p className="form-alert" role="alert">{error}</p>}{canEdit && <button className="button button-primary" disabled={busy}>Save branch</button>}
  </form>;
}
export function SpaceManager({ initial, sports, branch, canEdit }: { initial: Space[]; sports: Sport[]; branch: Branch; canEdit: boolean }) {
  const router = useRouter(); const [editing, setEditing] = useState<Space | null | "new">(null);
  const [form, setForm] = useState({ name: "", sportTypeId: sports[0]?.id ?? "", branchId: branch.id, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null as number | null });
  const [error, setError] = useState(""); const [busy, start] = useTransition();
  function open(item: Space | "new") { setEditing(item); setForm(item === "new" ? { name: "", sportTypeId: sports[0]?.id ?? "", branchId: branch.id, status: "ACTIVE", bookingIntervalMinutes: 60, minimumDurationMinutes: 60, maximumDurationMinutes: null } : { name: item.name, sportTypeId: item.sportTypeId, branchId: item.branchId, status: item.status, bookingIntervalMinutes: item.bookingIntervalMinutes, minimumDurationMinutes: item.minimumDurationMinutes, maximumDurationMinutes: item.maximumDurationMinutes }); setError(""); }
  return <div className="venue-stack">
    {canEdit && <button className="button button-primary venue-add" type="button" onClick={() => open("new")}>+ Add court or space</button>}
    {sports.map(sport => <section className="foundation-card" key={sport.id}><h2>{sport.name}</h2><div className="data-list">
      {initial.filter(item => item.sportTypeId === sport.id).map(item => <div className="data-row space-data-row" key={item.id}><div><strong>{item.name}</strong><small>{item.status.toLowerCase()} · {item.bookingIntervalMinutes} min interval · {item.minimumDurationMinutes} min minimum · {branch.name}</small></div>
      {canEdit && <div className="venue-actions"><button type="button" className="text-button" onClick={() => open(item)}>Edit</button>
        {item.status !== "ACTIVE" && <button type="button" className="text-button" onClick={() => start(async () => { const result = await resourceStatusAction(item.id, "ACTIVE"); setError(result.error ?? ""); router.refresh(); })}>Reactivate</button>}
        {item.status !== "MAINTENANCE" && <button type="button" className="text-button" onClick={() => start(async () => { const result = await resourceStatusAction(item.id, "MAINTENANCE"); setError(result.error ?? ""); router.refresh(); })}>Maintenance</button>}
        {item.status !== "DISABLED" && <button type="button" className="text-button" onClick={() => start(async () => { const result = await resourceStatusAction(item.id, "DISABLED"); setError(result.error ?? ""); router.refresh(); })}>Disable</button>}</div>}</div>)}
      {!initial.some(item => item.sportTypeId === sport.id) && <p className="small-note">No spaces yet.</p>}
    </div></section>)}
    {error && !editing && <p className="form-alert" role="alert">{error}</p>}
    {editing && <div className="venue-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><div className="venue-dialog" role="dialog" aria-modal="true" aria-label={editing === "new" ? "Add space" : "Edit space"}>
      <h2>{editing === "new" ? "Add a court or space" : "Edit space"}</h2>
      <form className="venue-stack" onSubmit={event => { event.preventDefault(); start(async () => { const result = await saveResourceAction(editing === "new" ? null : editing!.id, form); setError(result.error ?? ""); if (!result.error) { setEditing(null); router.refresh(); } }); }}>
        <label className="venue-field"><span>Name</span><input autoFocus required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label>
        <label className="venue-field"><span>Sport</span><select value={form.sportTypeId} onChange={event => setForm(current => ({ ...current, sportTypeId: event.target.value }))}>{sports.map(sport => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label>
        <label className="venue-field"><span>Status</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}><option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="DISABLED">Disabled</option></select></label>
        <div className="venue-grid">{(["bookingIntervalMinutes", "minimumDurationMinutes", "maximumDurationMinutes"] as const).map(key => <label className="venue-field" key={key}><span>{({ bookingIntervalMinutes: "Booking interval", minimumDurationMinutes: "Minimum duration", maximumDurationMinutes: "Maximum duration (optional)" })[key]} · minutes</span><input type="number" min="15" value={form[key] ?? ""} onChange={event => setForm(current => ({ ...current, [key]: event.target.value ? Number(event.target.value) : null }))} /></label>)}</div>
        {error && <p className="form-alert" role="alert">{error}</p>}<div className="setup-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Save space</button></div>
      </form>
    </div></div>}
  </div>;
}

