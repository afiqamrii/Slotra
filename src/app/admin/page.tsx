import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePlatformAdministrator } from "@/lib/platform-authorization";
import { superAdminOverview } from "@/lib/super-admin-service";
import { planDefinitions } from "@/lib/plan-entitlements";
export default async function AdminPage() {
  const session = await requirePlatformAdministrator(), data = await superAdminOverview(getDb(), session.user.id);
  const metrics = [{ label: "Organizations", value: data.totalOrganizations }, { label: "Active", value: data.lifecycle.find(row => row.status === "ACTIVE")?.total ?? 0 },
    { label: "Trialing", value: data.trialing }, { label: "Paid organizations", value: data.paid },
    { label: "MRR", value: "RM" + (data.mrrMinor / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 }) },
    { label: "Bookings this month", value: data.bookingsThisMonth }, { label: "Renewal needs attention", value: data.failed },
    { label: "Suspended / closed", value: data.lifecycle.filter(row => ["SUSPENDED", "CLOSED"].includes(row.status)).reduce((n, row) => n + row.total, 0) }];
  return <div className="foundation-page billing-page"><p className="eyebrow">SUPER ADMIN</p><h1>Platform overview</h1><p className="foundation-lead">Subscription health and venue activity across the platform.</p>
    <div className="billing-admin-metrics">{metrics.map(item => <article className="foundation-card" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
    <section className="foundation-card billing-history"><h2>Plan distribution</h2><ul>{data.distribution.map(item => <li key={item.code}><span>{planDefinitions[item.code as keyof typeof planDefinitions].name}</span><strong>{item.total}</strong></li>)}<li><span>Trial</span><strong>{data.trialing}</strong></li><li><span>Enterprise</span><strong>0 · custom billing not configured</strong></li></ul>
      <p className="billing-note">MRR includes active production subscriptions: monthly price, or annual price divided by 12. Trials, development simulations, legacy assignments, cancelled, expired and suspended venues are excluded.</p><Link className="button button-secondary" href="/admin/organizations">Manage organizations</Link></section></div>;
}
