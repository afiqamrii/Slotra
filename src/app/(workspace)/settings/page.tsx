import Link from "next/link";
import { requirePermission } from "@/lib/authorization";
export default async function SettingsPage() {
  await requirePermission("organization:view");
  return <div className="foundation-page"><p className="eyebrow">SETTINGS</p><h1>Venue settings</h1><p className="foundation-lead">Keep your location details current.</p><div className="foundation-card"><h2>Plan & Usage</h2><p>See your monthly bookings and venue limits at a glance.</p><Link className="button button-secondary" href="/settings/plan">View plan & usage</Link></div><div className="foundation-card"><h2>Branch</h2><p>Address, timezone and active status for your first venue.</p><Link className="button button-secondary" href="/settings/branch">Manage branch</Link></div><div className="foundation-card"><h2>Payments</h2><p>Pay-at-venue, deposits, and payment provider status.</p><Link className="button button-secondary" href="/settings/payments">Manage booking payments</Link></div></div>;
}

