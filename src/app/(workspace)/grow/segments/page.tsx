import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ArrowRight, Search, Tag, UsersRound } from "lucide-react";
import { organizations } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingMoney } from "@/lib/booking-format";
import { customerSegments, segmentNames, type SegmentKey } from "@/lib/business-segments";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { addCustomerTagAction, removeCustomerTagAction } from "./actions";
import styles from "../insights.module.css";

export const metadata: Metadata = { title: "Customer segments" };
type Params = { segment?: string; search?: string; page?: string; error?: string; saved?: string };
const keys = Object.keys(segmentNames) as SegmentKey[];

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { session, organization, member } = await requirePermission("report:view");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "CUSTOMER_SEGMENTATION")) redirect("/grow");
  const params = await searchParams;
  const segment = keys.includes(params.segment as SegmentKey) ? params.segment as SegmentKey : "all";
  const page = Number.isSafeInteger(Number(params.page)) ? Math.max(1, Math.min(1000, Number(params.page))) : 1;
  const search = (params.search ?? "").slice(0, 80);
  const [data, [venue]] = await Promise.all([
    customerSegments(db, session.user.id, organizationId, { segment, search, page }),
    db.select({ currency: organizations.currency, timezone: organizations.timezone }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1),
  ]);
  const canTag = hasPermission(member.role, "customer:manage");
  const href = (nextPage: number) => "/grow/segments?" + new URLSearchParams({
    segment, ...(search ? { search } : {}), page: String(nextPage),
  });
  return <div className="foundation-page grow-page">
    <Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / CUSTOMERS</p><h1>Customer segments</h1>
    <p className="foundation-lead">Find regulars, new players, and people worth reconnecting with. No messages are sent automatically from this page.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {params.saved && <p className="pro-success" role="status">Customer tag updated.</p>}
    <div className={styles.metricGrid}>
      <div className={styles.metric}><span>Returning customers</span><strong>{data.counts.returning}</strong><small>At least two past bookings</small></div>
      <div className={styles.metric}><span>Frequent players</span><strong>{data.counts.frequent}</strong><small>Four or more bookings in 90 days</small></div>
      <div className={styles.metric}><span>Regulars to reconnect with</span><strong>{data.regularInactive30}</strong><small>Three past bookings, none in 30 days or upcoming</small></div>
    </div>
    <nav className={styles.segmentNav} aria-label="Customer segments">
      {keys.map(key => <Link key={key} href={"/grow/segments?segment=" + key}
        aria-current={segment === key ? "page" : undefined} className={segment === key ? styles.selected : ""}>
        {segmentNames[key]} <span>{data.counts[key]}</span></Link>)}
    </nav>
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>{segmentNames[segment]}</h2>
        <p>{segment === "high_spend" ? "Top 10% by past booked value among customers with at least two bookings." :
          segment === "inactive_30" || segment === "inactive_60" ?
            "Based on their last past booking. Customers with a future booking are excluded." :
            "Based on non-cancelled bookings at this venue."}</p></div>
        <Link className="button button-secondary" href="/grow/promotions">Create promotion <ArrowRight size={15} /></Link></div>
      <form action="/grow/segments" method="get" className={styles.searchForm}>
        <input name="segment" type="hidden" value={segment} />
        <label htmlFor="segment-search"><Search size={17} aria-hidden="true" /> Search customers</label>
        <input id="segment-search" name="search" defaultValue={search} placeholder="Name, phone, or email" maxLength={80} />
        <button className="button button-secondary" type="submit">Search</button>
      </form>
      {data.customers.length ? <div className={styles.customerList}>{data.customers.map(customer =>
        <article key={customer.id} className={styles.customer}>
          <div className={styles.customerTop}><div><h3>{customer.name}</h3>
            <p>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</p></div>
            <div className={styles.customerStats}><span>{customer.bookingCount} past bookings</span>
              <strong>{bookingMoney(customer.bookedValueMinor, venue.currency)} booked</strong></div></div>
          <div className={styles.customerBottom}><p>{customer.lastPastAt ?
            `Last booking ${customer.lastPastAt.toLocaleDateString("en-MY", { timeZone: venue.timezone, day: "numeric", month: "short", year: "numeric" })}` :
            "No past bookings"}{customer.futureCount > 0 ? ` · ${customer.futureCount} upcoming` : ""}</p>
            <div className={styles.tags}>{customer.tags.map(tag =>
              <span key={tag.id} className={styles.tag}><Tag size={12} aria-hidden="true" />{tag.label}
                {canTag && <form action={removeCustomerTagAction}><input type="hidden" name="tagId" value={tag.id} />
                  <input type="hidden" name="segment" value={segment} />
                  <button aria-label={`Remove ${tag.label} tag from ${customer.name}`} type="submit">×</button></form>}</span>)}</div></div>
          {canTag && <form action={addCustomerTagAction} className={styles.tagForm}>
            <input type="hidden" name="customerId" value={customer.id} /><input type="hidden" name="segment" value={segment} />
            <label className="sr-only" htmlFor={`tag-${customer.id}`}>Add a tag for {customer.name}</label>
            <input id={`tag-${customer.id}`} name="label" list="customer-tag-suggestions" maxLength={40}
              placeholder="Add a tag, e.g. VIP" required />
            <button type="submit">Add tag</button></form>}
        </article>)}</div> :
        <div className={styles.empty}><UsersRound size={25} aria-hidden="true" /><h3>No customers here yet</h3>
          <p>{search ? "Try a different name or phone number." : "This segment will fill as customers book."}</p></div>}
      {canTag && <datalist id="customer-tag-suggestions"><option value="VIP" /><option value="Corporate" />
        <option value="Student" /><option value="Regular" /></datalist>}
      <div className={styles.pagination}><span>{data.matched} matching customers</span>
        <div>{page > 1 && <Link href={href(page - 1)}>← Previous</Link>}
          {page * data.pageSize < data.matched && <Link href={href(page + 1)}>Next →</Link>}</div></div>
    </section>
    <p className={styles.footnote}>Segments are based on booking records at this venue. “High spenders” uses booked value, not money collected. A cancelled, expired, or no-show booking does not count as a visit.</p>
  </div>;
}
