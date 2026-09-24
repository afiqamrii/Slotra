import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgePercent, Gift, HeartHandshake, UsersRound } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { businessAnalytics } from "@/lib/business-analytics";
import { bookingMoney } from "@/lib/booking-format";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import styles from "../insights.module.css";

export const metadata: Metadata = { title: "Business analytics" };
const periods = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last30", label: "Last 30 days" },
] as const;

export default async function BusinessAnalyticsPage({ searchParams }: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { session, organization } = await requirePermission("report:view");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "CUSTOMER_SEGMENTATION")) redirect("/grow");
  const params = await searchParams;
  const range = periods.find(item => item.key === params.range)?.key ?? "this_month";
  const data = await businessAnalytics(db, session.user.id, organizationId, { range });
  const money = (amount: number) => bookingMoney(amount, data.currency);
  return <div className="foundation-page grow-page">
    <Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / INSIGHTS</p><h1>Business analytics</h1>
    <p className="foundation-lead">See how memberships, packages, and promotions are being used—without mixing manual assignments with actual sales.</p>
    <nav className={styles.dateNav} aria-label="Analytics period">{periods.map(item =>
      <Link key={item.key} href={`/grow/analytics?range=${item.key}`}
        className={range === item.key ? styles.selected : ""} aria-current={range === item.key ? "page" : undefined}>
        {item.label}</Link>)}<span>{data.fromDate} – {data.toDate} · {data.timezone}</span></nav>
    <div className={styles.metricGrid}>
      <div className={styles.metric}><span>Active memberships</span><strong>{data.memberships.active}</strong><small>{data.memberships.activePlans} active plans</small></div>
      <div className={styles.metric}><span>Packages issued</span><strong>{data.packages.issued}</strong><small>Manually assigned this period</small></div>
      <div className={styles.metric}><span>Promotion redemptions</span><strong>{data.promotions.redemptions}</strong><small>On non-cancelled bookings</small></div>
    </div>
    <div className={styles.sectionGrid}>
      <section className={styles.section}><div className={styles.sectionHeader}><UsersRound size={19} aria-hidden="true" /><h2>Memberships</h2></div>
        <div className={styles.statRows}>
          <div className={styles.statRow}><span>Active members</span><strong>{data.memberships.active}</strong></div>
          <div className={styles.statRow}><span>Member bookings</span><strong>{data.memberships.memberBookings}</strong></div>
          <div className={styles.statRow}><span>Membership revenue</span><strong>Not tracked</strong></div>
        </div><p className={styles.sectionNote}>Member bookings count reservations by customers with an active membership covering the booking date—not confirmed benefit redemptions. Assignment does not collect a plan fee, so we do not report a sale.</p>
        <Link className="text-link" href="/grow/memberships">Manage memberships →</Link></section>
      <section className={styles.section}><div className={styles.sectionHeader}><Gift size={19} aria-hidden="true" /><h2>Packages & credits</h2></div>
        <div className={styles.statRows}>
          <div className={styles.statRow}><span>Packages issued this period</span><strong>{data.packages.issued}</strong></div>
          <div className={styles.statRow}><span>Credits used on bookings</span><strong>{(data.packages.creditsUsedMinutes / 60).toFixed(1)} h</strong></div>
          <div className={styles.statRow}><span>Credits remaining</span><strong>{(data.packages.creditsRemainingMinutes / 60).toFixed(1)} h</strong></div>
          <div className={styles.statRow}><span>Expiring within 30 days</span><strong>{data.packages.expiringWithin30Days}</strong></div>
          <div className={styles.statRow}><span>Packages sold</span><strong>Not tracked</strong></div>
        </div><p className={styles.sectionNote}>Packages are issued manually. Credits used exclude reversed bookings; remaining credits are the current balance, not a historical balance.</p>
        <Link className="text-link" href="/grow/packages">Manage packages →</Link></section>
      <section className={styles.section}><div className={styles.sectionHeader}><BadgePercent size={19} aria-hidden="true" /><h2>Promotions</h2></div>
        <div className={styles.statRows}>
          <div className={styles.statRow}><span>Redemptions</span><strong>{data.promotions.redemptions}</strong></div>
          <div className={styles.statRow}><span>Discount value</span><strong>{money(data.promotions.discountMinor)}</strong></div>
          <div className={styles.statRow}><span>Booked value influenced</span><strong>{money(data.promotions.bookingValueMinor)}</strong></div>
        </div><p className={styles.sectionNote}>Promotion metrics follow bookings scheduled in this period and exclude cancelled, expired, or unpaid holds. Booked value is not cash collected.</p>
        <Link className="text-link" href="/grow/promotions">Manage promotions →</Link></section>
      <section className={styles.section}><div className={styles.sectionHeader}><HeartHandshake size={19} aria-hidden="true" /><h2>Retention</h2></div>
        <div className={styles.statRows}>
          <div className={styles.statRow}><span>Returning-customer rate</span><strong>{data.retention.returningRate === null ? "—" : `${data.retention.returningRate}%`}</strong></div>
          <div className={styles.statRow}><span>Returning customers this period</span><strong>{data.retention.returning}</strong></div>
          <div className={styles.statRow}><span>Inactive for 30–59 days</span><strong>{data.retention.inactive30}</strong></div>
          <div className={styles.statRow}><span>Inactive for 60+ days</span><strong>{data.retention.inactive60}</strong></div>
          <div className={styles.statRow}><span>Regulars inactive 30+ days</span><strong>{data.retention.regularInactive30}</strong></div>
        </div><p className={styles.sectionNote}>Inactive customers have a past booking but no upcoming booking. Returning rate uses customers with a booking this period and a prior confirmed booking.</p>
        <Link className="text-link" href="/grow/segments?segment=inactive_30">View customer segments →</Link></section>
    </div>
    <p className={styles.footnote}>All figures are for this venue only. Financial totals here are booking snapshots, not an accounting ledger. Open <Link href="/reports">Reports</Link> for booked value, collected amounts, and operational trends.</p>
  </div>;
}
