import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { BranchEditor } from "@/components/venue-management";
export const dynamic = "force-dynamic";
export default async function BranchPage() {
  const { organization, member } = await requirePermission("branch:view");
  const [branch] = await getDb().select().from(branches).where(eq(branches.organizationId, organization.organizationId)).limit(1);
  return <div className="foundation-page"><p className="eyebrow">SETTINGS / BRANCH</p><h1>Branch settings</h1><p className="foundation-lead">Your first location and its local timezone.</p>
    {branch ? <div className="foundation-card"><BranchEditor initial={branch} canEdit={["OWNER", "ADMIN", "MANAGER"].includes(member.role)} /></div> : <p>Complete venue setup to create your first branch.</p>}</div>;
}
