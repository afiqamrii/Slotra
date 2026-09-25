import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, branches, customRoles, memberBranches, organizationMembers, users } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature, requireOrganizationFeature } from "@/lib/organization-entitlements";
import { permissions, type Permission } from "@/lib/permissions";

const roleInput = z.object({ name: z.string().trim().min(2).max(80),
  baseRole: z.enum(["ADMIN", "MANAGER", "STAFF", "VIEWER"]),
  permissions: z.array(z.enum(permissions)).max(permissions.length).transform(values => [...new Set(values)]),
});
const assignmentInput = z.object({ memberId: z.uuid(), branchIds: z.array(z.uuid()).max(5),
  scope: z.enum(["ALL", "SELECTED"]) }).refine(value => value.scope === "ALL" || value.branchIds.length > 0,
    "Select at least one branch");
const idInput = z.uuid();

async function manageAccess(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "ADVANCED_PERMISSIONS");
  const member = await authorizedMembership(db, actorId, organizationId, "member:update");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL")
    throw new Error("Permission denied");
  return member;
}

export async function recordAudit(db: BookingDatabase, event: {
  organizationId: string; branchId?: string | null; actorUserId?: string | null;
  action: string; entityType: string; entityId?: string | null; summary: string;
  details?: Record<string, string | number | boolean | null>;
}) {
  if (!await hasOrganizationFeature(db, event.organizationId, "AUDIT_LOGS")) return;
  await db.insert(auditLogs).values({ organizationId: event.organizationId, branchId: event.branchId ?? null,
    actorUserId: event.actorUserId ?? null, action: event.action, entityType: event.entityType,
    entityId: event.entityId ?? null, summary: event.summary.slice(0, 500), details: event.details ?? null });
}

export async function createCustomRole(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await manageAccess(db, actorId, organizationId);
  const input = roleInput.parse(raw);
  for (const permission of input.permissions)
    if (!await authorizedMembership(db, actorId, organizationId, permission as Permission))
      throw new Error("Cannot grant a permission you do not hold");
  return db.transaction(async tx => {
    const [role] = await tx.insert(customRoles).values({ ...input, organizationId, createdByUserId: actorId }).returning();
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "role.created", entityType: "custom_role",
      entityId: role.id, summary: `Created ${role.name} role` });
    return role;
  });
}

export async function assignCustomRole(db: BookingDatabase, actorId: string, organizationId: string,
  targetMemberId: string, roleId: string) {
  await manageAccess(db, actorId, organizationId);
  if (!idInput.safeParse(targetMemberId).success || !idInput.safeParse(roleId).success) throw new Error("Invalid role assignment");
  return db.transaction(async tx => {
    const [target] = await tx.select().from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.id, targetMemberId)))
      .for("update").limit(1);
    const [role] = await tx.select().from(customRoles).where(and(eq(customRoles.organizationId, organizationId),
      eq(customRoles.id, roleId), eq(customRoles.isActive, true))).limit(1);
    if (!target || !role || target.role === "OWNER" || target.userId === actorId) throw new Error("Role assignment not allowed");
    for (const permission of role.permissions)
      if (!await authorizedMembership(tx, actorId, organizationId, permission as Permission))
        throw new Error("Cannot assign a permission you do not hold");
    await tx.update(organizationMembers).set({ role: role.baseRole, customRoleId: role.id, updatedAt: new Date() })
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.id, targetMemberId)));
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "member.role_changed", entityType: "member",
      entityId: targetMemberId, summary: `Assigned ${role.name} role` });
  });
}

export async function setMemberBranches(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await manageAccess(db, actorId, organizationId);
  await requireOrganizationFeature(db, organizationId, "MULTI_BRANCH");
  const input = assignmentInput.parse(raw);
  if (new Set(input.branchIds).size !== input.branchIds.length) throw new Error("Duplicate branch selection");
  return db.transaction(async tx => {
    const [target] = await tx.select().from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.id, input.memberId)))
      .for("update").limit(1);
    if (!target || target.role === "OWNER" || target.userId === actorId) throw new Error("Branch assignment not allowed");
    if (input.scope === "SELECTED") {
      const found = await tx.select({ id: branches.id }).from(branches).where(and(
        eq(branches.organizationId, organizationId), eq(branches.isActive, true), inArray(branches.id, input.branchIds)));
      if (found.length !== input.branchIds.length) throw new Error("Branch not found");
    }
    await tx.delete(memberBranches).where(and(eq(memberBranches.organizationId, organizationId),
      eq(memberBranches.memberId, target.id)));
    if (input.scope === "SELECTED") await tx.insert(memberBranches).values(input.branchIds.map(branchId => ({
      organizationId, memberId: target.id, branchId,
    })));
    await tx.update(organizationMembers).set({ branchScope: input.scope, updatedAt: new Date() }).where(and(
      eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.id, target.id)));
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "member.branches_changed", entityType: "member",
      entityId: target.id, summary: input.scope === "ALL" ? "Assigned all branches" : `Assigned ${input.branchIds.length} branches` });
  });
}

export async function listAuditLogs(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireOrganizationFeature(db, organizationId, "AUDIT_LOGS");
  if (!await authorizedMembership(db, actorId, organizationId, "audit:view")) throw new Error("Permission denied");
  const input = z.object({ branchId: z.uuid().optional(), actorUserId: z.uuid().optional(),
    action: z.string().max(100).optional(), entityType: z.string().max(60).optional(),
    from: z.iso.date().optional(), to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1) }).parse(raw);
  return db.select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType,
    summary: auditLogs.summary, details: auditLogs.details, createdAt: auditLogs.createdAt,
    actorName: users.name, branchName: branches.name })
    .from(auditLogs).leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .leftJoin(branches, and(eq(auditLogs.organizationId, branches.organizationId), eq(auditLogs.branchId, branches.id)))
    .where(and(eq(auditLogs.organizationId, organizationId),
      ...(input.branchId ? [eq(auditLogs.branchId, input.branchId)] : []),
      ...(input.actorUserId ? [eq(auditLogs.actorUserId, input.actorUserId)] : []),
      ...(input.action ? [eq(auditLogs.action, input.action)] : []),
      ...(input.entityType ? [eq(auditLogs.entityType, input.entityType)] : []),
      ...(input.from ? [gte(auditLogs.createdAt, new Date(`${input.from}T00:00:00Z`))] : []),
      ...(input.to ? [lt(auditLogs.createdAt, new Date(new Date(`${input.to}T00:00:00Z`).getTime() + 86_400_000))] : [])))
    .orderBy(desc(auditLogs.createdAt)).limit(50).offset((input.page - 1) * 50);
}
