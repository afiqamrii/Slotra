import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { branches, customerMemberships, customers, membershipPlans } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { assignMembershipAction, createMembershipAction } from "../actions";

export const metadata: Metadata = { title: "Memberships" };
export default async function MembershipsPage({ searchParams }: {
  searchParams: Promise<{ template?: string; error?: string; saved?: string; assigned?: string }>;
}) {
  const { organization, member } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "MEMBERSHIPS")) redirect("/grow");
  const params = await searchParams;
  const [plans, assigned, people, branch] = await Promise.all([
    db.select().from(membershipPlans).where(eq(membershipPlans.organizationId, orgId)).orderBy(membershipPlans.createdAt).limit(100),
    db.select({ membership: customerMemberships, customer: customers.name, plan: membershipPlans.name })
      .from(customerMemberships).innerJoin(customers, and(eq(customers.organizationId, orgId), eq(customers.id, customerMemberships.customerId)))
      .innerJoin(membershipPlans, and(eq(membershipPlans.organizationId, orgId), eq(membershipPlans.id, customerMemberships.planId)))
      .where(eq(customerMemberships.organizationId, orgId)).limit(100),
    db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(customers.name).limit(200),
    db.select({ id: branches.id, timezone: branches.timezone }).from(branches)
      .where(eq(branches.organizationId, orgId)).limit(1).then(rows => rows[0]),
  ]);
  const canEdit = hasPermission(member.role, "organization:update");
  const credits = params.template === "credits";
  const priority = params.template === "priority";
  const discount = !credits && !priority;
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / MEMBERSHIPS</p><h1>Memberships</h1>
    <p className="foundation-lead">Create a benefit for regular players, then assign it to a customer. Membership fees are not charged automatically.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {(params.saved || params.assigned) && <p className="pro-success" role="status">Membership saved.</p>}
    {canEdit && <section className="foundation-card grow-form-card"><h2>Create a membership</h2>
      <div className="grow-templates"><Link className={discount ? "selected" : ""} href="/grow/memberships?template=discount">Discount member</Link>
        <Link className={priority ? "selected" : ""} href="/grow/memberships?template=priority">Priority member</Link>
        <Link className={credits ? "selected" : ""} href="/grow/memberships?template=credits">Monthly hours</Link></div>
      <form action={createMembershipAction} className="grow-form">
        <label>Name<input name="name" required minLength={2} defaultValue={credits ? "Monthly 5 Hours" : discount ? "Regular player" : "Priority player"} /></label>
        <label>Description<input name="description" maxLength={500} placeholder="What players get" /></label>
        <div className="grow-form-pair"><label>Plan price · RM<input name="price" type="number" step="0.01" min="0" required defaultValue="30" /></label>
          <label>Billing period<select name="billingPeriod" defaultValue="MONTHLY"><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select></label></div>
        <div className="grow-form-pair"><label>Benefit<select name="discountType" defaultValue={discount ? "PERCENT" : "NONE"}>
          <option value="PERCENT">Percentage discount</option><option value="FIXED">Fixed RM discount</option><option value="NONE">No price discount</option></select></label>
          <label>Discount value<input name="discountValue" type="number" min="0" step="1" defaultValue={discount ? 10 : 0} /></label></div>
        <label>Book up to this many days ahead · optional<input name="advanceDays" type="number" min="1" max="365" defaultValue={priority ? 14 : undefined} /></label>
        <label>Hours included in each manual monthly assignment<input name="creditsHours" type="number" min="0" max="1000" step="0.5" defaultValue={credits ? 5 : 0} /></label>
        <p className="grow-form-help">Assignment and monthly renewal are manual. The plan price is descriptive until billing is connected. Credits are deducted when staff select them for a booking. Eligible members can book farther ahead in the staff flow, within the venue booking limit.</p>
        <button className="button button-primary" type="submit">Create membership</button>
      </form></section>}
    {canEdit && branch && plans.length > 0 && people.length > 0 && <section className="foundation-card grow-form-card"><h2>Assign to a player</h2>
      <form action={assignMembershipAction} className="grow-form"><input type="hidden" name="branchId" value={branch.id} />
        <label>Customer<select name="customerId" required>{people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.phone}</option>)}</select></label>
        <label>Membership<select name="planId" required>{plans.filter(plan => plan.isActive).map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        <div className="grow-form-pair"><label>Starts<input name="startDate" type="date" required /></label><label>Ends<input name="endDate" type="date" required /></label></div>
        <button className="button button-secondary" type="submit">Assign membership</button>
      </form></section>}
    <section className="foundation-card grow-list-card"><h2>Plans</h2>{plans.length ? <div className="grow-list">{plans.map(plan =>
      <div key={plan.id}><div><strong>{plan.name}</strong><small>{plan.description || "No description"}</small></div>
        <span>{plan.discountType === "PERCENT" ? `${plan.discountValue}% off` : plan.discountType === "FIXED" ? `RM${(plan.discountValue / 100).toFixed(2)} off` : "No price discount"}</span>
        <b>RM{(plan.priceMinor / 100).toFixed(2)} / {plan.billingPeriod.toLowerCase()}</b></div>)}</div> :
      <p className="grow-empty">No memberships yet. Start with a simple discount for regulars.</p>}</section>
    <section className="foundation-card grow-list-card"><h2>Assigned players</h2>{assigned.length ? <div className="grow-list">{assigned.map(row =>
      <div key={row.membership.id}><div><strong>{row.customer}</strong><small>{row.plan}</small></div>
        <span>{row.membership.status} · {row.membership.remainingCreditsMinutes > 0 ? `${(row.membership.remainingCreditsMinutes / 60).toFixed(1)} hours left · ` : ""}
          until {row.membership.endsAt.toLocaleDateString("en-MY", { timeZone: branch?.timezone ?? "Asia/Kuala_Lumpur" })}</span></div>)}</div> :
      <p className="grow-empty">No players have a membership yet.</p>}</section>
  </div>;
}
