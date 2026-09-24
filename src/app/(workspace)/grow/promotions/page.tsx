import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { branches, promotions } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { createPromotionAction } from "../actions";

export const metadata: Metadata = { title: "Promotions" };
export default async function PromotionsPage({ searchParams }: {
  searchParams: Promise<{ template?: string; error?: string; saved?: string }>;
}) {
  const { organization, member } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "PROMOTIONS")) redirect("/grow");
  const params = await searchParams;
  const [branch] = await db.select({ id: branches.id, timezone: branches.timezone }).from(branches)
    .where(eq(branches.organizationId, orgId)).limit(1);
  const rows = await db.select().from(promotions).where(eq(promotions.organizationId, orgId))
    .orderBy(promotions.createdAt).limit(100);
  const canEdit = hasPermission(member.role, "organization:update");
  const first = params.template === "first";
  const fixed = params.template === "fixed";
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / PROMOTIONS</p><h1>Promo codes</h1>
    <p className="foundation-lead">Create a discount with clear dates and a usage cap. Every code is validated and priced on the server when a booking is saved.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {params.saved && <p className="pro-success" role="status">Promo code created.</p>}
    {canEdit && branch && <section className="foundation-card grow-form-card"><h2>Create a promotion</h2>
      <div className="grow-templates"><Link className={!first && !fixed ? "selected" : ""} href="/grow/promotions?template=percent">10% discount</Link>
        <Link className={fixed ? "selected" : ""} href="/grow/promotions?template=fixed">Fixed discount</Link>
        <Link className={first ? "selected" : ""} href="/grow/promotions?template=first">First booking</Link></div>
      <form action={createPromotionAction} className="grow-form"><input type="hidden" name="branchId" value={branch.id} />
        <label>Name<input name="name" required minLength={2} defaultValue={first ? "First booking welcome" : fixed ? "RM10 off" : "10% off"} /></label>
        <label>Code<input name="code" required minLength={3} maxLength={40} pattern="[A-Za-z0-9-]+" defaultValue={first ? "WELCOME10" : fixed ? "SAVE10" : "PLAY10"} /></label>
        <div className="grow-form-pair"><label>Discount<select name="discountType" defaultValue={fixed ? "FIXED" : "PERCENT"}>
          <option value="PERCENT">Percent off</option><option value="FIXED">RM amount off</option></select></label>
          <label>Value · % or RM<input name="discountValue" type="number" min="1" step="1" required defaultValue="10" /></label></div>
        <div className="grow-form-pair"><label>Starts<input name="startDate" type="date" required /></label>
          <label>Ends<input name="endDate" type="date" required /></label></div>
        <div className="grow-form-pair"><label>Minimum booking · RM<input name="minimumSpend" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Total uses allowed<input name="usageLimit" type="number" min="1" placeholder="Unlimited" /></label></div>
        <div className="grow-form-pair"><label>Uses per customer<input name="perCustomerLimit" type="number" min="1" defaultValue={first ? "1" : undefined} placeholder="Unlimited" /></label>
          <label>Maximum discount · RM<input name="maximumDiscount" type="number" min="0.01" step="0.01" placeholder="No cap" /></label></div>
        <label className="grow-check"><input type="checkbox" name="newCustomerOnly" defaultChecked={first} /> First booking only</label>
        <button className="button button-primary" type="submit">Create promo code</button>
      </form></section>}
    <section className="foundation-card grow-list-card"><h2>Codes</h2>{rows.length ? <div className="grow-list">{rows.map(row =>
      <div key={row.id}><div><strong>{row.code}</strong><small>{row.name} · {row.isActive ? "Active" : "Disabled"}</small></div>
        <span>{row.usedCount}{row.usageLimit ? ` / ${row.usageLimit}` : ""} used</span>
        <b>{row.discountType === "PERCENT" ? `${row.discountValue}% off` : `RM${(row.discountValue / 100).toFixed(2)} off`}</b></div>)}</div> :
      <p className="grow-empty">No codes yet. Start with a limited welcome offer.</p>}</section>
  </div>;
}
