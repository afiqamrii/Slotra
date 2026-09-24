import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { branches, organizationSports, resources, sportTypes } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { listPricingRules } from "@/lib/business-pricing";
import { createPricingRuleAction } from "../actions";

export const metadata: Metadata = { title: "Peak Pricing" };
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function hhmm(minute: number) { return minute === 1440 ? "12:00 AM next day" :
  new Date(Date.UTC(2026, 0, 1, Math.floor(minute / 60), minute % 60))
    .toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }); }

export default async function PricingPage({ searchParams }: {
  searchParams: Promise<{ template?: string; error?: string; saved?: string }>;
}) {
  const { session, organization, member } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "DYNAMIC_PRICING")) redirect("/grow");
  const params = await searchParams;
  const [branch] = await db.select().from(branches).where(and(eq(branches.organizationId, orgId), eq(branches.isActive, true))).limit(1);
  const [sports, spaces, rules] = await Promise.all([
    db.select({ id: sportTypes.id, name: sportTypes.name }).from(organizationSports)
      .innerJoin(sportTypes, eq(organizationSports.sportTypeId, sportTypes.id))
      .where(eq(organizationSports.organizationId, orgId)).orderBy(sportTypes.name),
    db.select({ id: resources.id, name: resources.name, sportTypeId: resources.sportTypeId })
      .from(resources).where(eq(resources.organizationId, orgId)).orderBy(resources.name),
    listPricingRules(db, session.user.id, orgId),
  ]);
  const weekend = params.template === "weekend";
  const peak = params.template === "peak";
  const canEdit = hasPermission(member.role, "organization:update");
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / PRICING</p><h1>Peak & off-peak pricing</h1>
    <p className="foundation-lead">Choose when a rate applies. The price is based on the booking’s local start time and checked again when saved.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {params.saved && <p className="pro-success" role="status">Pricing rule saved.</p>}
    {canEdit && branch && sports.length > 0 && <section className="foundation-card grow-form-card"><h2>Add a rate</h2>
      <div className="grow-templates"><Link href="/grow/pricing?template=weekday" className={!weekend && !peak ? "selected" : ""}>Weekday</Link>
        <Link href="/grow/pricing?template=peak" className={peak ? "selected" : ""}>Evening peak</Link>
        <Link href="/grow/pricing?template=weekend" className={weekend ? "selected" : ""}>Weekend</Link></div>
      <form action={createPricingRuleAction} className="grow-form">
        <input type="hidden" name="branchId" value={branch.id} />
        <label>Name<input name="name" required minLength={2} maxLength={80} defaultValue={weekend ? "Weekend" : peak ? "Evening peak" : "Weekday"} /></label>
        <label>Sport<select name="sportTypeId" required>{sports.map(sport => <option value={sport.id} key={sport.id}>{sport.name}</option>)}</select></label>
        <label>Specific space · optional<select name="resourceId" defaultValue=""><option value="">All spaces for this sport</option>{spaces.map(space =>
          <option value={space.id} key={space.id}>{space.name} · {sports.find(sport => sport.id === space.sportTypeId)?.name}</option>)}</select></label>
        <fieldset className="grow-days"><legend>Days</legend>{days.map((day, index) => <label key={day}><input type="checkbox" name="weekday" value={index}
          defaultChecked={weekend ? index === 0 || index === 6 : index >= 1 && index <= 5} />{day}</label>)}</fieldset>
        <div className="grow-form-pair"><label>From<input name="startTime" type="time" required defaultValue={peak ? "18:00" : "08:00"} /></label>
          <label>Until<input name="endTime" type="time" required defaultValue={peak ? "23:00" : weekend ? "00:00" : "18:00"} /></label></div>
        <label>Rate per hour · RM<input name="amount" type="number" inputMode="decimal" min="0" max="9999999" step="0.01" required defaultValue={peak ? "35" : weekend ? "40" : "25"} /></label>
        <p className="grow-form-help">A space-specific rate overrides its sport rate. If times overlap within the same sport or space, we’ll ask you to adjust them.</p>
        <button className="button button-primary" type="submit">Save rate</button>
      </form></section>}
    <section className="foundation-card grow-list-card"><h2>Current rates</h2>
      {rules.length ? <div className="grow-list">{rules.map(rule => <div key={rule.id}>
        <div><strong>{rule.name}</strong><small>{sports.find(sport => sport.id === rule.sportTypeId)?.name}
          {rule.resourceId ? ` · ${spaces.find(space => space.id === rule.resourceId)?.name ?? "Space"}` : " · All spaces"}</small></div>
        <span>{rule.weekdays.map(day => days[day]).join(", ")} · {hhmm(rule.startMinute)}–{hhmm(rule.endMinute)}</span>
        <b>RM{(rule.amountMinor / 100).toFixed(2)}/hour</b>
      </div>)}</div> : <p className="grow-empty">No special rates yet. Your base sport prices still apply.</p>}</section>
  </div>;
}
