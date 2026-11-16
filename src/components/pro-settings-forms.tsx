"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { addCorporateCustomerAction, assignBranchesAction, assignRoleAction, createApiKeyAction, createCorporateBookingAction,
  createCorporateAction, createDomainAction, createRoleAction, createWebhookAction,
  revokeApiKeyAction, saveBrandingAction, testWebhookAction, toggleWebhookAction,
  verifyDomainAction, type ProFormState } from "@/app/actions/pro";
import { apiScopes, outboundEventTypes } from "@/lib/pro-integration-contracts";
import { permissionGroups } from "@/lib/permissions";

const initial: ProFormState = { error: null, success: null };
function Feedback({ state }: { state: ProFormState }) {
  return <>{state.error && <p role="alert" className="form-alert">{state.error}</p>}
    {state.success && <p role="status" className="form-success">{state.success}</p>}
    {state.secret && <label className="field">Secret — copy once<input readOnly value={state.secret} onFocus={event => event.target.select()} /></label>}
    {state.dnsName && <div className="pro-dns-instructions"><p>Add this TXT record with your DNS provider:</p>
      <label className="field">Name<input readOnly value={state.dnsName} onFocus={event => event.target.select()} /></label>
      <label className="field">Value<input readOnly value={state.dnsValue ?? ""} onFocus={event => event.target.select()} /></label></div>}</>;
}

export function ProRoleCreator() {
  const [state, action, pending] = useActionState(createRoleAction, initial);
  return <form action={action} className="pro-form"><div className="pro-form-row"><label className="field">Role name<input name="name" required minLength={2} placeholder="Receptionist" /></label>
    <label className="field">Starting template<select name="baseRole" defaultValue="STAFF"><option value="STAFF">Staff</option>
      <option value="VIEWER">Viewer</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></label></div>
    <p className="small-note">Only the permissions checked below will apply. Every active teammate can see their venue workspace; Owner access cannot be assigned here.</p>
    <div className="pro-permission-groups">{Object.entries(permissionGroups).map(([group, values]) =>
      <details key={group} open={group === "Bookings" || group === "Customers"}><summary>{group} <small>{values.length} options</small></summary>
        <fieldset>{values.map(value => <label key={value} className="pro-check">
        <input type="checkbox" name="permissions" value={value} defaultChecked={["booking:view", "booking:create", "customer:view"].includes(value)} />
        <span>{value.split(":")[1].replaceAll("_", " ")}</span></label>)}</fieldset></details>)}</div>
    <button className="button button-primary" disabled={pending}>Create role</button><Feedback state={state} /></form>;
}

export function ProMemberControls({ memberId, roleId, scope, assigned, roles, branches }: {
  memberId: string; roleId: string | null; scope: string; assigned: string[];
  roles: { id: string; name: string }[]; branches: { id: string; name: string }[];
}) {
  const [roleState, roleAction, rolePending] = useActionState(assignRoleAction, initial);
  const [branchState, branchAction, branchPending] = useActionState(assignBranchesAction, initial);
  const [selectedScope, setSelectedScope] = useState(scope);
  return <div className="pro-member-controls"><form action={roleAction} className="pro-inline-form">
    <input type="hidden" name="memberId" value={memberId} /><label className="field">Custom role
      <select name="roleId" defaultValue={roleId ?? ""} required><option value="">Choose a role</option>
        {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
    <button className="button button-secondary" disabled={rolePending || !roles.length}>Assign role</button><Feedback state={roleState} /></form>
    <form action={branchAction} className="pro-inline-form"><input type="hidden" name="memberId" value={memberId} />
      <label className="field">Branch access<select name="scope" value={selectedScope} onChange={event => setSelectedScope(event.target.value)}>
        <option value="ALL">All branches</option><option value="SELECTED">Selected branches</option></select></label>
      {selectedScope === "SELECTED" && <div className="pro-branch-checks">{branches.map(branch =>
        <label key={branch.id} className="pro-check"><input type="checkbox" name="branchIds" value={branch.id}
          defaultChecked={assigned.includes(branch.id)} />{branch.name}</label>)}</div>}
      <button className="button button-secondary" disabled={branchPending}>Save branch access</button><Feedback state={branchState} /></form></div>;
}

export function ProBrandingForm({ initialValues }: { initialValues: { displayName: string; description: string;
  color: string; logoUrl: string; coverImageUrl: string; hidePoweredBy: boolean } }) {
  const [state, action, pending] = useActionState(saveBrandingAction, initial);
  return <form action={action} className="pro-form"><div className="pro-form-row"><label className="field">Display name
    <input name="displayName" defaultValue={initialValues.displayName} minLength={2} required /></label>
    <label className="field">Accent color<input type="color" name="color" defaultValue={initialValues.color} /></label></div>
    <label className="field">Short description<textarea name="description" maxLength={500} rows={3}
      defaultValue={initialValues.description} placeholder="Tell guests what makes this venue special." /></label>
    <div className="pro-form-row"><label className="field">Logo HTTPS URL<input name="logoUrl" type="url" defaultValue={initialValues.logoUrl} placeholder="https://..." /></label>
      <label className="field">Cover image HTTPS URL<input name="coverImageUrl" type="url" defaultValue={initialValues.coverImageUrl} placeholder="https://..." /></label></div>
    <p className="small-note">Upload a logo or cover in <Link className="text-link" href="/settings/storage">Venue images</Link> when uploads are available, or use secure image URLs here.</p>
    <label className="pro-check"><input type="checkbox" name="hidePoweredBy" defaultChecked={initialValues.hidePoweredBy} />Hide “Powered by {brand.name}” on the booking page</label>
    <button className="button button-primary" disabled={pending}>Save branding</button><Feedback state={state} /></form>;
}

export function ProDomainCreator() {
  const [state, action, pending] = useActionState(createDomainAction, initial);
  return <form action={action} className="pro-inline-form"><label className="field">Custom booking hostname
    <input name="hostname" required placeholder="booking.example.com" /></label>
    <button className="button button-secondary" disabled={pending}>Add domain</button><Feedback state={state} /></form>;
}

export function ProDomainVerifier({ id }: { id: string }) {
  const [state, action, pending] = useActionState(verifyDomainAction.bind(null, id), initial);
  return <form action={action}><button className="button button-secondary" disabled={pending} type="submit">Check DNS</button><Feedback state={state} /></form>;
}

export function ProApiKeyCreator({ branches }: { branches: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createApiKeyAction, initial);
  return <form action={action} className="pro-form"><div className="pro-form-row"><label className="field">Key name<input name="name" required placeholder="My integration" /></label>
    <label className="field">Branch scope<select name="branchId"><option value="">All branches</option>
      {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div>
    <fieldset className="pro-check-grid"><legend>Allowed actions</legend>{apiScopes.map(scope =>
      <label key={scope} className="pro-check"><input type="checkbox" name="scopes" value={scope} />{scope.replace(":", " · ")}</label>)}</fieldset>
    <button className="button button-primary" disabled={pending}>Create API key</button><Feedback state={state} /></form>;
}

export function ProApiKeyRevoke({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revokeApiKeyAction.bind(null, id), initial);
  return <form action={action}><button className="text-button revoke-button" disabled={pending}>Revoke</button><Feedback state={state} /></form>;
}

export function ProWebhookCreator() {
  const [state, action, pending] = useActionState(createWebhookAction, initial);
  return <form action={action} className="pro-form"><div className="pro-form-row"><label className="field">Endpoint name
    <input name="name" required placeholder="Operations sync" /></label><label className="field">HTTPS URL
    <input name="url" type="url" required placeholder="https://example.com/webhooks" /></label></div>
    <fieldset className="pro-check-grid"><legend>Events</legend>{outboundEventTypes.map(type =>
      <label key={type} className="pro-check"><input type="checkbox" name="eventTypes" value={type} />{type}</label>)}</fieldset>
    <button className="button button-primary" disabled={pending}>Save endpoint</button><Feedback state={state} /></form>;
}

export function ProWebhookControls({ id, active }: { id: string; active: boolean }) {
  const [toggleState, toggleAction, togglePending] = useActionState(toggleWebhookAction.bind(null, id, !active), initial);
  const [testState, testAction, testPending] = useActionState(testWebhookAction.bind(null, id), initial);
  return <div className="pro-row-actions"><form action={toggleAction}><button className="button button-secondary" disabled={togglePending}>
    {active ? "Disable" : "Enable"}</button><Feedback state={toggleState} /></form>
    {active && <form action={testAction}><button className="button button-secondary" disabled={testPending}>Queue test</button>
      <Feedback state={testState} /></form>}</div>;
}

export function ProCorporateCreator() {
  const [state, action, pending] = useActionState(createCorporateAction, initial);
  return <form action={action} className="pro-form"><div className="pro-form-row"><label className="field">Company name
    <input name="name" required placeholder="PETRONAS" /></label><label className="field">Billing email
    <input name="billingEmail" type="email" required /></label></div><div className="pro-form-row">
    <label className="field">Contact person<input name="contactPerson" /></label>
    <label className="field">Monthly allowance (RM)<input name="monthlyLimit" type="number" min="0" step="0.01" required /></label></div>
    <label className="field">Billing terms<input name="billingTerms" placeholder="e.g. monthly statement, 30 days" /></label>
    <label className="pro-check"><input type="checkbox" name="allowOverage" />Allow bookings over the monthly allowance</label>
    <button className="button button-primary" disabled={pending}>Create account</button><Feedback state={state} /></form>;
}

export function ProCorporateCustomerForm({ accounts, customers }: { accounts: { id: string; name: string }[];
  customers: { id: string; name: string; phone: string }[] }) {
  const [state, action, pending] = useActionState(addCorporateCustomerAction, initial);
  return <form action={action} className="pro-inline-form"><label className="field">Company<select name="accountId" required>
    <option value="">Choose company</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <label className="field">Approved customer<select name="customerId" required><option value="">Choose customer</option>
      {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label>
    <button className="button button-secondary" disabled={pending}>Approve customer</button><Feedback state={state} /></form>;
}

export function ProCorporateBookingForm({ approved, spaces, today }: { approved: {
  accountId: string; accountName: string; customerId: string; customerName: string }[];
  spaces: { id: string; name: string; branchName: string }[]; today: string }) {
  const [state, action, pending] = useActionState(createCorporateBookingAction, initial);
  return <form action={action} className="pro-form"><div className="pro-form-row">
    <label className="field">Company & approved customer<select name="accountCustomer" required>
      <option value="">Choose account and customer</option>{approved.map(pair => <option key={`${pair.accountId}:${pair.customerId}`}
        value={`${pair.accountId}:${pair.customerId}`}>{pair.accountName} · {pair.customerName}</option>)}</select></label>
    <label className="field">Court or space<select name="resourceId" required><option value="">Choose a space</option>
      {spaces.map(space => <option key={space.id} value={space.id}>{space.branchName} · {space.name}</option>)}</select></label></div>
    <div className="pro-form-row"><label className="field">Date<input name="date" type="date" defaultValue={today} required /></label>
      <label className="field">Start time<input name="time" type="time" required /></label>
      <label className="field">Duration<select name="duration"><option value="60">1 hour</option>
        <option value="120">2 hours</option><option value="30">30 minutes</option></select></label></div>
    <label className="field">Notes (optional)<input name="notes" maxLength={2000} /></label>
    <button className="button button-primary" disabled={pending || !approved.length || !spaces.length}>Create corporate booking</button>
    <p className="small-note">The booking engine validates the time and price. The account allowance is reserved transactionally.</p>
    <Feedback state={state} /></form>;
}
