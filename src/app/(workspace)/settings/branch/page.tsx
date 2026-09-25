import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { basePrices, branches, operatingHours, organizationSports, organizations, sportTypes } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { BranchEditor } from "@/components/venue-management";
import { BranchCreateForm } from "@/components/branch-create-form";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { branchContext } from "@/lib/branch-context";
export const dynamic = "force-dynamic";
export default async function BranchPage({ searchParams }: { searchParams: Promise<{ branchId?: string; add?: string }> }) {
  const { organization, member, session } = await requirePermission("branch:view");
  const db = getDb(), organizationId = organization.organizationId;
  const params = await searchParams;
  const [branchRows, pro, venue, selectedBranch] = await Promise.all([
    db.select().from(branches).where(eq(branches.organizationId, organizationId)).orderBy(branches.createdAt),
    hasOrganizationFeature(db, organizationId, "MULTI_BRANCH"),
    db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    branchContext(db, organizationId, session.user.id),
  ]);
  const allBranches = branchRows.filter(item => selectedBranch.branches.some(allowed => allowed.id === item.id));
  const branch = params.branchId ? allBranches.find(item => item.id === params.branchId) : allBranches[0];
  const first = allBranches[0];
  const configBranch = params.add === "1" ? first : branch;
  const [sports, priceRows, hourRows] = configBranch ? await Promise.all([
    db.select({ id: sportTypes.id, name: sportTypes.name }).from(organizationSports)
      .innerJoin(sportTypes, eq(organizationSports.sportTypeId, sportTypes.id))
      .where(eq(organizationSports.organizationId, organizationId)).orderBy(sportTypes.name),
    db.select({ sportTypeId: basePrices.sportTypeId, amountMinor: basePrices.amountMinor }).from(basePrices)
      .where(and(eq(basePrices.organizationId, organizationId), eq(basePrices.branchId, configBranch.id))),
    db.select({ dayOfWeek: operatingHours.dayOfWeek, startMinute: operatingHours.startMinute,
      endMinute: operatingHours.endMinute }).from(operatingHours)
      .where(and(eq(operatingHours.organizationId, organizationId), eq(operatingHours.branchId, configBranch.id), isNull(operatingHours.resourceId))),
  ]) : [[], [], []];
  const canEdit = member.branchScope === "ALL" && ["OWNER", "ADMIN", "MANAGER"].includes(member.role);
  return <div className="foundation-page"><p className="eyebrow">SETTINGS / BRANCHES</p><h1>Branches</h1>
    <p className="foundation-lead">Each location has its own hours, courts and prices. Your venue remains one workspace.</p>
    {pro && allBranches.length > 0 && <nav className="booking-tabs" aria-label="Branches">{allBranches.map(item =>
      <Link key={item.id} className={branch?.id === item.id && params.add !== "1" ? "booking-tab active" : "booking-tab"}
        href={`/settings/branch?branchId=${item.id}`}>{item.name}{!item.isActive ? " · Paused" : ""}</Link>)}
      {canEdit && <Link className={params.add === "1" ? "booking-tab active" : "booking-tab"} href="/settings/branch?add=1">+ Add branch</Link>}</nav>}
    {params.add === "1" && pro && canEdit ? <section className="foundation-card"><h2>Add a branch</h2>
      <p>Start with this location’s essentials. Add its courts and spaces next.</p>
      <BranchCreateForm prices={sports.map(sport => ({ sportTypeId: sport.id, name: sport.name,
        amountMinor: priceRows.find(price => price.sportTypeId === sport.id)?.amountMinor ?? 0 }))}
        initialHours={hourRows.map(row => ({ ...row, closed: false }))} timezone={venue[0]?.timezone ?? "Asia/Kuala_Lumpur"} /></section> :
      branch ? <div className="foundation-card"><h2>{branch.name}</h2>{pro && canEdit ?
        <BranchCreateForm key={branch.id} initial={branch} prices={sports.map(sport => ({ sportTypeId: sport.id, name: sport.name,
          amountMinor: priceRows.find(price => price.sportTypeId === sport.id)?.amountMinor ?? 0,
          selected: priceRows.some(price => price.sportTypeId === sport.id) }))}
          initialHours={hourRows.map(row => ({ ...row, closed: false }))} timezone={branch.timezone} /> :
        <BranchEditor initial={branch} canEdit={canEdit} />}
        {pro && <p className="small-note">Courts and spaces for this branch can be managed separately in Courts & Spaces.</p>}</div> :
        <p>Complete venue setup to create your first branch.</p>}
  </div>;
}
