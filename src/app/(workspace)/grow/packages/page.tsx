import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { customerPackages, customers, packagePlans } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { createPackageAction, issuePackageAction } from "../actions";

export const metadata: Metadata = { title: "Packages" };
export default async function PackagesPage({ searchParams }: {
  searchParams: Promise<{ error?: string; saved?: string; issued?: string }>;
}) {
  const { organization, member } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "PACKAGES")) redirect("/grow");
  const params = await searchParams;
  const [plans, owned, people] = await Promise.all([
    db.select().from(packagePlans).where(eq(packagePlans.organizationId, orgId)).orderBy(packagePlans.createdAt).limit(100),
    db.select({ package: customerPackages, customer: customers.name, plan: packagePlans.name }).from(customerPackages)
      .innerJoin(customers, and(eq(customers.organizationId, orgId), eq(customers.id, customerPackages.customerId)))
      .innerJoin(packagePlans, and(eq(packagePlans.organizationId, orgId), eq(packagePlans.id, customerPackages.planId)))
      .where(eq(customerPackages.organizationId, orgId)).limit(100),
    db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(customers.name).limit(200),
  ]);
  const canEdit = hasPermission(member.role, "organization:update");
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / PACKAGES</p><h1>Playing-time packages</h1>
    <p className="foundation-lead">Give regular players a balance of hours. Credits are used atomically when staff create a booking and restored on cancellation.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {(params.saved || params.issued) && <p className="pro-success" role="status">Package saved.</p>}
    {canEdit && <section className="foundation-card grow-form-card"><h2>Create a package</h2>
      <div className="grow-templates"><span className="selected">10-hour pack</span></div>
      <form action={createPackageAction} className="grow-form">
        <label>Name<input name="name" required minLength={2} defaultValue="10 Hours" /></label>
        <label>Description<input name="description" maxLength={500} placeholder="Optional details for staff" /></label>
        <div className="grow-form-pair"><label>Hours included<input name="hours" type="number" min="0.5" max="1000" step="0.5" required defaultValue="10" /></label>
          <label>Plan price · RM<input name="price" type="number" min="0" step="0.01" required defaultValue="250" /></label></div>
        <label>Expires after · days<input name="validDays" type="number" min="1" max="730" defaultValue="180" /></label>
        <p className="grow-form-help">Price is a reference only. Assigning a package does not collect or record payment.</p>
        <button className="button button-primary" type="submit">Create package</button>
      </form></section>}
    {canEdit && plans.length > 0 && people.length > 0 && <section className="foundation-card grow-form-card"><h2>Grant hours to a player</h2>
      <form action={issuePackageAction} className="grow-form">
        <label>Customer<select name="customerId" required>{people.map(person =>
          <option key={person.id} value={person.id}>{person.name} · {person.phone}</option>)}</select></label>
        <label>Package<select name="planId" required>{plans.filter(plan => plan.isActive).map(plan =>
          <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        <p className="grow-form-help">Manual grant only. Record any money received separately in Payments.</p>
        <button className="button button-secondary" type="submit">Grant package hours</button>
      </form></section>}
    <section className="foundation-card grow-list-card"><h2>Packages</h2>{plans.length ? <div className="grow-list">{plans.map(plan =>
      <div key={plan.id}><div><strong>{plan.name}</strong><small>{plan.creditsMinutes / 60} hours · {plan.validDays ? `${plan.validDays} days valid` : "No expiry"}</small></div>
        <b>RM{(plan.priceMinor / 100).toFixed(2)}</b></div>)}</div> :
      <p className="grow-empty">No packages yet. A 10-hour pack is a good place to start.</p>}</section>
    <section className="foundation-card grow-list-card"><h2>Customer balances</h2>{owned.length ? <div className="grow-list">{owned.map(row =>
      <div key={row.package.id}><div><strong>{row.customer}</strong><small>{row.plan}</small></div>
        <span>{row.package.status}</span><b>{(row.package.remainingMinutes / 60).toFixed(1)} of {(row.package.totalMinutes / 60).toFixed(1)} hours left</b></div>)}</div> :
      <p className="grow-empty">No package hours granted yet.</p>}</section>
  </div>;
}
