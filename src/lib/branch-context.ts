import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { branches, memberBranches, organizationMembers } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export const branchCookieName = "slotra_branch";

export async function branchContext(db: BookingDatabase, organizationId: string, userId: string) {
  const [member] = await db.select({ id: organizationMembers.id, branchScope: organizationMembers.branchScope })
    .from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId), eq(organizationMembers.status, "ACTIVE"))).limit(1);
  if (!member) return { branches: [], selected: null, canSwitch: false };
  const allowed = member.branchScope === "SELECTED" ? (await db.select({ id: memberBranches.branchId })
    .from(memberBranches).where(and(eq(memberBranches.organizationId, organizationId),
      eq(memberBranches.memberId, member.id)))).map(row => row.id) : null;
  const rows = allowed?.length === 0 ? [] : await db.select({ id: branches.id, name: branches.name, timezone: branches.timezone,
    isActive: branches.isActive }).from(branches).where(and(eq(branches.organizationId, organizationId),
      ...(allowed ? [inArray(branches.id, allowed)] : [])))
    .orderBy(branches.createdAt);
  const pro = await hasOrganizationFeature(db, organizationId, "MULTI_BRANCH");
  const cookie = (await cookies()).get(branchCookieName)?.value;
  const selected = pro && !allowed && cookie === "all" ? "all" :
    pro && rows.some(row => row.id === cookie && row.isActive) ? cookie! :
      pro && !allowed ? "all" : rows.find(row => row.isActive)?.id ?? null;
  return { branches: rows, selected, canSwitch: pro && rows.length > 1 };
}

export async function validatedBranchSelection(db: BookingDatabase, organizationId: string, userId: string, value: string) {
  const context = await branchContext(db, organizationId, userId);
  if (value === "all") {
    if (context.selected !== "all" && !context.branches.length) throw new Error("Branch not found");
    const [member] = await db.select({ scope: organizationMembers.branchScope }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "ACTIVE"))).limit(1);
    if (member?.scope !== "ALL" || !await hasOrganizationFeature(db, organizationId, "MULTI_BRANCH"))
      throw new Error("Plan feature unavailable");
    return value;
  }
  const branch = context.branches.find(row => row.id === value && row.isActive);
  if (!branch) throw new Error("Branch not found");
  return branch.id;
}
