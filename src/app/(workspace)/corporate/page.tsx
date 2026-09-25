import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches, corporateAccounts, corporateMembers, customers, organizations, resources } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { listCorporateAccounts } from "@/lib/pro-corporate-service";
import { localDateAt } from "@/lib/booking-time";
import { bookingMoney } from "@/lib/booking-format";
import { ProCorporateBookingForm, ProCorporateCreator, ProCorporateCustomerForm } from "@/components/pro-settings-forms";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function CorporatePage() {
  const { organization, session, member } = await requirePermission("report:view_financial");
  if (member.branchScope !== "ALL") notFound();
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "CORPORATE_ACCOUNTS")) return <div className="foundation-page">
    <h1>Corporate accounts</h1><p>Available on Pro.</p><Link className="button button-primary" href="/settings/plans">Compare plans</Link></div>;
  const [accounts, customerRows, approvedRows, spaces, [venue]] = await Promise.all([
    listCorporateAccounts(db, session.user.id, organizationId),
    db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers)
      .where(eq(customers.organizationId, organizationId)).orderBy(customers.name).limit(200),
    db.select({ accountId: corporateMembers.accountId, customerId: corporateMembers.customerId,
      accountName: corporateAccounts.name, customerName: customers.name }).from(corporateMembers)
      .innerJoin(corporateAccounts, and(eq(corporateMembers.organizationId, corporateAccounts.organizationId),
        eq(corporateMembers.accountId, corporateAccounts.id)))
      .innerJoin(customers, and(eq(corporateMembers.organizationId, customers.organizationId),
        eq(corporateMembers.customerId, customers.id)))
      .where(eq(corporateMembers.organizationId, organizationId)).limit(200),
    db.select({ id: resources.id, name: resources.name, branchName: branches.name }).from(resources)
      .innerJoin(branches, and(eq(resources.organizationId, branches.organizationId), eq(resources.branchId, branches.id)))
      .where(and(eq(resources.organizationId, organizationId), eq(resources.status, "ACTIVE"))).limit(200),
    db.select({ timezone: organizations.timezone, currency: organizations.currency }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
  ]);
  const canManage = ["OWNER", "ADMIN", "MANAGER"].includes(organization.role);
  return <div className="foundation-page pro-settings-page"><p className="eyebrow">PRO / CUSTOMERS</p><h1>Corporate accounts</h1>
    <p className="foundation-lead">Give approved people a shared monthly booking allowance. This tracks usage; it does not issue invoices or collect payment.</p>
    <section className="foundation-card"><h2>Accounts</h2>{accounts.length ? <div className="data-list">{accounts.map(account =>
      <div className="data-row" key={account.id}><span><strong>{account.name}</strong><small>{account.billingEmail} · {account.isActive ? "Active" : "Inactive"}</small></span>
        <span>{account.bookingCount} bookings · {bookingMoney(account.totalValueMinor, venue.currency)} value<br />
          <small>{bookingMoney(account.currentUsageMinor, venue.currency)} / {bookingMoney(account.monthlyLimitMinor, venue.currency)} this month</small></span></div>)}</div> :
      <p>No corporate accounts yet.</p>}</section>
    {canManage && <><section className="foundation-card"><h2>Add a company</h2><ProCorporateCreator /></section>
      <section className="foundation-card"><h2>Approve a customer</h2><p>Only approved customers can use an account allowance.</p>
        <ProCorporateCustomerForm accounts={accounts} customers={customerRows} /></section></>}
    <section className="foundation-card"><h2>Create a corporate booking</h2><ProCorporateBookingForm approved={approvedRows}
      spaces={spaces} today={localDateAt(new Date(), venue.timezone).toString()} /></section>
  </div>;
}
