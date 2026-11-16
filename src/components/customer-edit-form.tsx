"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Save } from "lucide-react";
import { updateCustomerAction } from "@/app/(workspace)/customers/[id]/actions";

export function CustomerEditForm({ customer }: { customer: { id: string; name: string; phone: string; email: string | null; notes: string | null; updatedAt: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const revision = useRef(customer.updatedAt), saving = useRef(false);
  return <form className="customer-edit-form" onChange={() => setSaved(false)} onSubmit={async event => {
    event.preventDefault();
    if (saving.current) return;
    const values = new FormData(event.currentTarget);
    saving.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const result = await updateCustomerAction(customer.id, { name: values.get("name"), phone: values.get("phone"),
        email: String(values.get("email") ?? "").trim(), notes: values.get("notes"), expectedUpdatedAt: revision.current });
      if (result.error) setError(result.error);
      else if (result.updatedAt) { revision.current = result.updatedAt; setSaved(true); router.refresh(); }
    } catch { setError("Could not confirm the update. Refresh this page to check the saved details before trying again."); }
    finally { saving.current = false; setBusy(false); }
  }}>
    <fieldset disabled={busy}><legend className="sr-only">Edit customer contact details and notes</legend>
      <label><span>Name</span><input name="name" defaultValue={customer.name} required minLength={2} maxLength={120} autoComplete="name" /></label>
      <div className="customer-edit-pair"><label><span>Phone</span><input name="phone" type="tel" defaultValue={customer.phone} required minLength={6} maxLength={30} autoComplete="tel" /></label><label><span>Email <small>optional</small></span><input name="email" type="email" defaultValue={customer.email ?? ""} autoComplete="email" /></label></div>
      <label><span>Internal notes <small>optional</small></span><textarea name="notes" rows={4} maxLength={2000} defaultValue={customer.notes ?? ""} placeholder="Useful preferences or context for your team" /><small>Visible to authorized venue staff. Never shown on public booking confirmations.</small></label>
      <div className="customer-edit-footer"><button className="button button-primary" type="submit"><Save size={15} aria-hidden />{busy ? "Saving…" : "Save changes"}</button>{saved && <span className="customer-saved" role="status"><Check size={15} aria-hidden /> Changes saved</span>}</div>
    </fieldset>{error && <p className="form-alert" role="alert">{error}</p>}
  </form>;
}
