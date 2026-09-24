import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, CalendarClock, Gift, Megaphone, QrCode, Repeat2, Settings2, UserRoundSearch, UsersRound, Workflow, Zap } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature, organizationPlan } from "@/lib/organization-entitlements";
import { planCatalog } from "@/lib/plan-catalog";

export const metadata: Metadata = { title: "Grow" };
export default async function GrowPage() {
  const { organization } = await requirePermission("organization:view");
  const plan = await organizationPlan(getDb(), organization.organizationId);
  const business = await hasOrganizationFeature(getDb(), organization.organizationId, "MEMBERSHIPS");
  const cards = [
    { href: "/grow/pricing", title: "Peak & off-peak pricing", detail: "Set rates for busy and quiet hours.", icon: Zap },
    { href: "/grow/recurring", title: "Recurring bookings", detail: "Reserve the same time every week.", icon: Repeat2 },
    { href: "/grow/memberships", title: "Memberships", detail: "Reward regulars with simple benefits.", icon: UsersRound },
    { href: "/grow/packages", title: "Packages", detail: "Give customers a balance of playing time.", icon: Gift },
    { href: "/grow/promotions", title: "Promotions", detail: "Offer clear, limited discount codes.", icon: Megaphone },
    { href: "/grow/waitlist", title: "Waitlist", detail: "Keep interest when a time is full.", icon: CalendarClock },
    { href: "/grow/booking-qr", title: "Booking QR", detail: "Give walk-by guests a direct way to book.", icon: QrCode },
    { href: "/grow/booking-rules", title: "Booking rules", detail: "Set notice, buffer, and change cutoffs.", icon: Settings2 },
    { href: "/grow/automations", title: "Automations", detail: "Set simple reminders and inactive-player tags.", icon: Workflow },
    { href: "/grow/segments", title: "Customer segments", detail: "Find regulars and players who have been away.", icon: UserRoundSearch },
    { href: "/grow/analytics", title: "Business analytics", detail: "Track memberships, package hours, and offers.", icon: BarChart3 },
  ];
  return <div className="foundation-page grow-page">
    <p className="eyebrow">GROW</p><h1>More ways to fill your venue</h1>
    <p className="foundation-lead">Simple tools for regular players, busy hours, and open spaces.</p>
    {!business ? <section className="foundation-card grow-upgrade"><div><p className="eyebrow">BUSINESS PLAN</p>
      <h2>Automate and grow.</h2><p>Business adds peak pricing, recurring bookings, memberships, packages, promotions, and more. Your current {planCatalog[plan].name} plan stays active.</p></div>
      <Link className="button button-primary" href="/settings/plans">Compare plans <ArrowRight size={16} /></Link></section> :
      <div className="grow-card-grid">{cards.map(({ href, title, detail, icon: Icon }) =>
        <Link href={href} className="foundation-card grow-card" key={href}><Icon size={22} aria-hidden="true" />
          <strong>{title}</strong><span>{detail}</span><small>Open <ArrowRight size={14} /></small></Link>)}</div>}
  </div>;
}
