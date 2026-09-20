import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, lte, ne, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import { invitations, organizationMembers, organizations, users } from "@/db/schema";
import { hasPermission, isRole, type Permission, type Role } from "@/lib/permissions";
import { planLimit, type StandardPlan } from "@/lib/plan-entitlements";

// The same query interface is used by the live PostgreSQL client and PGlite tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Database = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
export const organizationInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(3).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});
export const invitationInput = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: z.enum(["ADMIN", "MANAGER", "STAFF", "VIEWER"]),
});
export const organizationIdInput = z.uuid();

export async function membershipsFor(database: Database, userId: string) {
  return database.select({
    organizationId: organizations.id, name: organizations.name, slug: organizations.slug,
    role: organizationMembers.role,
  }).from(organizationMembers).innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "ACTIVE")))
    .orderBy(organizations.name);
}

export async function authorizedMembership(database: Database, userId: string, organizationId: string, permission: Permission = "organization:view") {
  if (!organizationIdInput.safeParse(organizationId).success) return null;
  const [member] = await database.select({ role: organizationMembers.role })
    .from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId), eq(organizationMembers.status, "ACTIVE"))).limit(1);
  return member && hasPermission(member.role, permission) ? { organizationId, role: member.role as Role } : null;
}

export async function createOrganization(database: Database, userId: string, raw: unknown) {
  const input = organizationInput.parse(raw);
  return database.transaction(async (tx) => {
    const [organization] = await tx.insert(organizations).values(input).returning();
    await tx.insert(organizationMembers).values({ organizationId: organization.id, userId, role: "OWNER" });
    return organization;
  });
}

export async function selectOrganization(database: Database, userId: string, organizationId: string) {
  const membership = await authorizedMembership(database, userId, organizationId);
  if (!membership) throw new Error("Organization access denied");
  return membership;
}

export function invitationHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function assertStaffSeat(database: Database, organizationId: string, excludingInvitationId?: string) {
  const [venue] = await database.select({ planCode: organizations.planCode }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!venue) throw new Error("Venue not found");
  const limit = planLimit(venue.planCode as StandardPlan, "STAFF_SEATS");
  if (limit === null) return;
  const [[active], [pending]] = await Promise.all([
    database.select({ used: count() }).from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "ACTIVE"), ne(organizationMembers.role, "OWNER"))),
    database.select({ used: count() }).from(invitations).where(and(
      eq(invitations.organizationId, organizationId), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date()),
      ...(excludingInvitationId ? [ne(invitations.id, excludingInvitationId)] : []))),
  ]);
  if ((active?.used ?? 0) + (pending?.used ?? 0) >= limit)
    throw new Error(venue.planCode === "STARTER"
      ? "You've reached the Starter staff-seat limit. Upgrade to Professional for more staff access."
      : "You've reached your plan's staff-seat limit.");
}

export async function createInvitation(database: Database, actorId: string, organizationId: string, raw: unknown) {
  const input = invitationInput.parse(raw);
  if (!await authorizedMembership(database, actorId, organizationId, "member:invite")) throw new Error("Permission denied");
  const token = randomBytes(32).toString("base64url");
  return database.transaction(async tx => {
    await assertStaffSeat(tx, organizationId);
    const [invitation] = await tx.insert(invitations).values({
      organizationId, email: input.email, role: input.role, invitedBy: actorId,
      tokenHash: invitationHash(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).returning();
    return { invitation, token };
  });
}

export async function renewInvitationLink(database: Database, actorId: string, organizationId: string, invitationId: string) {
  if (!z.uuid().safeParse(invitationId).success) throw new Error("Invalid invitation");
  if (!await authorizedMembership(database, actorId, organizationId, "member:invite")) throw new Error("Permission denied");
  const token = randomBytes(32).toString("base64url");
  const [updated] = await database.update(invitations).set({
    tokenHash: invitationHash(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
  }).where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, organizationId),
    eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date()))).returning({ id: invitations.id });
  if (!updated) throw new Error("Invitation is no longer pending");
  return token;
}

export async function acceptInvitation(database: Database, userId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid invitation");
  const hash = invitationHash(token);
  await database.update(invitations).set({ status: "EXPIRED", updatedAt: new Date() })
    .where(and(eq(invitations.tokenHash, hash), eq(invitations.status, "PENDING"), lte(invitations.expiresAt, new Date())));
  return database.transaction(async (tx) => {
    const [user] = await tx.select({ email: users.email, verified: users.emailVerified })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.verified) throw new Error("Verify your email before accepting this invitation");
    // A row lock serializes concurrent acceptance of the same token.
    const rows = await tx.execute(sql`select id, organization_id, email, role from app.invitations
      where token_hash = ${hash} and status = 'PENDING' and expires_at > now() for update`);
    const invitation = rows.rows[0] as { id: string; organization_id: string; email: string; role: string } | undefined;
    if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase() || !isRole(invitation.role)) {
      throw new Error("Invitation is invalid, expired, or belongs to another email");
    }
    const [alreadyMember] = await tx.select({ id: organizationMembers.id }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, invitation.organization_id), eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "ACTIVE"))).limit(1);
    if (!alreadyMember) await assertStaffSeat(tx, invitation.organization_id, invitation.id);
    await tx.insert(organizationMembers).values({
      organizationId: invitation.organization_id, userId, role: invitation.role,
    }).onConflictDoNothing();
    const [member] = await tx.select({ id: organizationMembers.id })
      .from(organizationMembers).where(and(eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, invitation.organization_id),
        eq(organizationMembers.status, "ACTIVE"))).limit(1);
    if (!member) throw new Error("Existing membership is inactive");
    await tx.update(invitations).set({ status: "ACCEPTED", acceptedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date())));
    return invitation.organization_id;
  });
}

export async function revokeInvitation(database: Database, actorId: string, organizationId: string, invitationId: string) {
  if (!await authorizedMembership(database, actorId, organizationId, "member:invite")) throw new Error("Permission denied");
  if (!z.uuid().safeParse(invitationId).success) throw new Error("Invalid invitation");
  await database.update(invitations).set({ status: "REVOKED", updatedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, organizationId), eq(invitations.status, "PENDING")));
}

