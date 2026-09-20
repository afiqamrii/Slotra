"use client";
import { useActionState, useState } from "react";
import { createOrganizationAction, type OrganizationSetupState } from "@/app/actions/organization";

const initialState: OrganizationSetupState = { error: null };

function makeSlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export function OrganizationSetupForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return <form action={action} className="auth-form">
    <div className="field">
      <label htmlFor="org-name">Business name</label>
      <input autoComplete="organization" id="org-name" name="name" required minLength={2} maxLength={120}
        placeholder="Your venue business" value={name} onChange={(event) => {
          const nextName = event.target.value;
          setName(nextName);
          if (!slugEdited) setSlug(makeSlug(nextName));
        }} />
      <small>The name your team will see.</small>
    </div>
    <div className="field">
      <label htmlFor="org-slug">Workspace address</label>
      <input autoCapitalize="none" autoComplete="off" id="org-slug" name="slug" required
        pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={100}
        placeholder="your-business" value={slug} onChange={(event) => {
          setSlugEdited(true);
          setSlug(makeSlug(event.target.value));
        }} />
      <small>Suggested from your business name. You can edit it.</small>
      {slug && <span className="workspace-preview">Your workspace: <strong>/{slug}</strong></span>}
    </div>
    {state.error && <p className="form-alert" role="alert">{state.error}</p>}
    <button className="button button-primary auth-submit" disabled={pending} type="submit">
      {pending ? "Creating workspace…" : "Create workspace"}
    </button>
    <p className="setup-footnote">You can add your first branch and spaces after this.</p>
  </form>;
}

