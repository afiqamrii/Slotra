import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, branches, organizations, rateLimits } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { recordAudit } from "@/lib/pro-access-service";
import { apiScopes, type ApiScope } from "@/lib/pro-integration-contracts";
import type { Permission } from "@/lib/permissions";

export { apiScopes, type ApiScope } from "@/lib/pro-integration-contracts";
const scopePermissions: Record<ApiScope, Permission> = {
  "bookings:read": "booking:view", "bookings:write": "booking:create",
  "customers:read": "customer:view", "customers:write": "customer:manage",
  "resources:read": "resource:view", "availability:read": "booking:view",
};
const createInput = z.object({ name: z.string().trim().min(2).max(100), branchId: z.uuid().nullable().optional(),
  scopes: z.array(z.enum(apiScopes)).min(1).max(apiScopes.length).transform(values => [...new Set(values)]) });

export async function createApiKey(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireOrganizationFeature(db, organizationId, "API_ACCESS");
  const actor = await authorizedMembership(db, actorId, organizationId, "integration:manage");
  if (!actor || !["OWNER", "ADMIN"].includes(actor.role) || actor.branchScope !== "ALL")
    throw new Error("Permission denied");
  const input = createInput.parse(raw);
  if (input.branchId) {
    const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.organizationId, organizationId),
      eq(branches.id, input.branchId), eq(branches.isActive, true))).limit(1);
    if (!branch) throw new Error("Branch not found");
  }
  for (const scope of input.scopes) {
    if (!await authorizedMembership(db, actorId, organizationId, scopePermissions[scope], input.branchId ?? undefined))
      throw new Error("You cannot grant API scopes outside your own permissions");
  }
  const secret = `sltr_${randomBytes(32).toString("base64url")}`;
  return db.transaction(async tx => {
    const [key] = await tx.insert(apiKeys).values({ organizationId, branchId: input.branchId ?? null,
      name: input.name, keyPrefix: secret.slice(0, 16), keyHash: createHash("sha256").update(secret).digest("hex"),
      scopes: input.scopes, createdByUserId: actorId }).returning({ id: apiKeys.id, name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, branchId: apiKeys.branchId });
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "api_key.created", entityType: "api_key",
      entityId: key.id, summary: `Created API key ${key.name}` });
    return { ...key, secret };
  });
}

export async function revokeApiKey(db: BookingDatabase, actorId: string, organizationId: string, keyId: string) {
  await requireOrganizationFeature(db, organizationId, "API_ACCESS");
  const actor = await authorizedMembership(db, actorId, organizationId, "integration:manage");
  if (!actor || !["OWNER", "ADMIN"].includes(actor.role) || actor.branchScope !== "ALL")
    throw new Error("Permission denied");
  if (!z.uuid().safeParse(keyId).success) throw new Error("API key not found");
  await db.transaction(async tx => {
    const [key] = await tx.update(apiKeys).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(apiKeys.organizationId, organizationId), eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, name: apiKeys.name });
    if (!key) throw new Error("API key not found");
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "api_key.revoked", entityType: "api_key",
      entityId: key.id, summary: `Revoked API key ${key.name}` });
  });
}

export async function listApiKeys(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "API_ACCESS");
  const actor = await authorizedMembership(db, actorId, organizationId, "integration:manage");
  if (!actor || !["OWNER", "ADMIN"].includes(actor.role) || actor.branchScope !== "ALL")
    throw new Error("Permission denied");
  return db.select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix,
    scopes: apiKeys.scopes, branchId: apiKeys.branchId, createdAt: apiKeys.createdAt,
    lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt }).from(apiKeys)
    .where(eq(apiKeys.organizationId, organizationId)).orderBy(desc(apiKeys.createdAt)).limit(100);
}

export async function authenticateApiKey(db: BookingDatabase, header: string | null, scope: ApiScope,
  now = Date.now(), limit = 120) {
  const token = header?.match(/^Bearer (sltr_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return { ok: false as const, reason: "INVALID_KEY" as const };
  const hash = createHash("sha256").update(token).digest("hex");
  const [key] = await db.select({ id: apiKeys.id, organizationId: apiKeys.organizationId,
    branchId: apiKeys.branchId, scopes: apiKeys.scopes, revokedAt: apiKeys.revokedAt,
    createdByUserId: apiKeys.createdByUserId,
    isActive: organizations.isActive })
    .from(apiKeys).innerJoin(organizations, eq(apiKeys.organizationId, organizations.id))
    .where(eq(apiKeys.keyHash, hash)).limit(1);
  if (!key || key.revokedAt || !key.isActive || !await (async () => {
    try { await requireOrganizationFeature(db, key.organizationId, "API_ACCESS"); return true; }
    catch { return false; }
  })()) return { ok: false as const, reason: "INVALID_KEY" as const };
  if (!Array.isArray(key.scopes) || !key.scopes.includes(scope))
    return { ok: false as const, reason: "WRONG_SCOPE" as const };
  // Keys cannot outlive the creator's tenant access or bypass later role/branch restrictions.
  if (!await authorizedMembership(db, key.createdByUserId, key.organizationId, scopePermissions[scope], key.branchId ?? undefined))
    return { ok: false as const, reason: "INVALID_KEY" as const };
  if (key.branchId) {
    const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, key.branchId),
      eq(branches.organizationId, key.organizationId), eq(branches.isActive, true))).limit(1);
    if (!branch) return { ok: false as const, reason: "INVALID_KEY" as const };
  }
  const bucketStart = Math.floor(now / 60_000) * 60_000;
  const [state] = await db.insert(rateLimits).values({ key: `api:${key.id}`, count: 1, lastRequest: bucketStart })
    .onConflictDoUpdate({ target: rateLimits.key, set: {
      count: sql`case when ${rateLimits.lastRequest} < ${bucketStart} then 1 else ${rateLimits.count} + 1 end`,
      lastRequest: bucketStart,
    } })
    .returning({ count: rateLimits.count });
  if (state.count > limit) return { ok: false as const, reason: "RATE_LIMITED" as const };
  await db.update(apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(apiKeys.id, key.id));
  return { ok: true as const, organizationId: key.organizationId, branchId: key.branchId,
    keyId: key.id, actorId: key.createdByUserId };
}
