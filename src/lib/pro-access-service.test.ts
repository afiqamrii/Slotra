import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { authorizedMembership, createOrganization } from "@/lib/organization-service";
import { assignCustomRole, createCustomRole, listAuditLogs, setMemberBranches } from "@/lib/pro-access-service";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from "@/lib/pro-api-service";
import { createTenantDomain, normalizeCustomHostname, updateProBranding, verifyTenantDomain } from "@/lib/pro-domain-service";
import { createWebhookEndpoint, listWebhookDeliveries, queueOutboundEvent, queueTestWebhook,
  recordWebhookAttempt, safeWebhookUrl, setWebhookActive, signWebhookPayload } from "@/lib/pro-webhooks";
import { createCorporateAccount } from "@/lib/pro-corporate-service";
import { proExecutiveReport } from "@/lib/pro-reporting";

describe("Pro access boundaries", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  let ownerId = "", staffId = "", outsiderId = "", organizationId = "", otherOrganizationId = "";
  let memberId = "", branchA = "", branchB = "", otherBranch = "";
  beforeAll(async () => {
    vi.stubEnv("SLOTRA_WEBHOOK_SIGNING_KEY", "test-master-key-with-at-least-32-characters");
    const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) for (const statement of readFileSync(resolve(`drizzle/${tag}.sql`), "utf8")
      .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    const people = await db.insert(schema.users).values([
      { name: "Owner", email: "pro-owner@test.example" },
      { name: "Staff", email: "pro-staff@test.example" },
      { name: "Other", email: "pro-other@test.example" },
    ]).returning();
    [ownerId, staffId, outsiderId] = people.map(person => person.id);
    organizationId = (await createOrganization(db, ownerId, { name: "Pro Venue", slug: "pro-venue" })).id;
    otherOrganizationId = (await createOrganization(db, outsiderId, { name: "Other Venue", slug: "other-pro-venue" })).id;
    memberId = (await db.insert(schema.organizationMembers).values({ organizationId, userId: staffId, role: "STAFF" }).returning())[0].id;
    const branches = await db.insert(schema.branches).values([
      { organizationId, name: "Kerteh", slug: "kerteh" },
      { organizationId, name: "Kemaman", slug: "kemaman" },
      { organizationId: otherOrganizationId, name: "Other", slug: "other" },
    ]).returning();
    [branchA, branchB, otherBranch] = branches.map(branch => branch.id);
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await postgres.close(); });

  it("rejects Pro-only roles and branch assignments on Starter", async () => {
    await expect(createCustomRole(db, ownerId, organizationId, { name: "Reception", baseRole: "STAFF",
      permissions: ["booking:view"] })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(setMemberBranches(db, ownerId, organizationId, { memberId, scope: "SELECTED",
      branchIds: [branchA] })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(createTenantDomain(db, ownerId, organizationId, "booking.example.com"))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(createApiKey(db, ownerId, organizationId, { name: "Starter key", scopes: ["bookings:read"] }))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(createWebhookEndpoint(db, ownerId, organizationId, { name: "Starter hook",
      url: "https://example.com/hook", eventTypes: ["booking.created"] }))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(createCorporateAccount(db, ownerId, organizationId, { name: "Starter corporate",
      billingEmail: "billing@example.com", monthlyLimitMinor: 10000 }))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
  });

  it("applies custom permissions without granting role defaults", async () => {
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, organizationId));
    const role = await createCustomRole(db, ownerId, organizationId, { name: "Front desk", baseRole: "STAFF",
      permissions: ["booking:view", "booking:create"] });
    await assignCustomRole(db, ownerId, organizationId, memberId, role.id);
    expect(await authorizedMembership(db, staffId, organizationId, "organization:view")).not.toBeNull();
    expect(await authorizedMembership(db, staffId, organizationId, "booking:create")).not.toBeNull();
    expect(await authorizedMembership(db, staffId, organizationId, "payment:record_manual")).toBeNull();
    expect(await authorizedMembership(db, staffId, otherOrganizationId, "booking:view")).toBeNull();
    const logs = await listAuditLogs(db, ownerId, organizationId, {});
    expect(logs.map(log => log.action)).toEqual(expect.arrayContaining(["role.created", "member.role_changed"]));
  });

  it("enforces selected branches and rejects cross-tenant assignments", async () => {
    await expect(setMemberBranches(db, ownerId, organizationId, { memberId, scope: "SELECTED",
      branchIds: [otherBranch] })).rejects.toThrow("Branch not found");
    await setMemberBranches(db, ownerId, organizationId, { memberId, scope: "SELECTED", branchIds: [branchA] });
    expect(await authorizedMembership(db, staffId, organizationId, "booking:create", branchA)).not.toBeNull();
    expect(await authorizedMembership(db, staffId, organizationId, "booking:create", branchB)).toBeNull();
    expect(await authorizedMembership(db, staffId, organizationId, "booking:create")).toBeNull();
    const rows = await db.select().from(schema.memberBranches).where(and(eq(schema.memberBranches.organizationId, organizationId),
      eq(schema.memberBranches.memberId, memberId)));
    expect(rows.map(row => row.branchId)).toEqual([branchA]);
  });

  it("limits financial reports to an explicitly assigned branch and permission", async () => {
    const input = { range: "today", branchId: branchA };
    await expect(proExecutiveReport(db, staffId, organizationId, input)).rejects.toThrow("Permission denied");
    const role = await createCustomRole(db, ownerId, organizationId, { name: "Branch finance", baseRole: "STAFF",
      permissions: ["organization:view", "report:view_financial"] });
    await assignCustomRole(db, ownerId, organizationId, memberId, role.id);
    await expect(proExecutiveReport(db, staffId, organizationId, { range: "today" }))
      .rejects.toThrow("Permission denied");
    await expect(proExecutiveReport(db, staffId, organizationId, { range: "today", branchId: branchB }))
      .rejects.toThrow("Permission denied");
    const report = await proExecutiveReport(db, staffId, organizationId, input);
    expect(report.branchOptions.map(branch => branch.id)).toEqual([branchA]);
    expect(report.branches.map(branch => branch.id)).toEqual([branchA]);
  });

  it("does not expose another tenant's audit entries", async () => {
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, otherOrganizationId));
    expect(await listAuditLogs(db, outsiderId, otherOrganizationId, {})).toEqual([]);
    await expect(listAuditLogs(db, outsiderId, organizationId, {})).rejects.toThrow("Permission denied");
  });

  it("stores only an API-key hash, enforces scopes, revocation, branch, and rate limits", async () => {
    const key = await createApiKey(db, ownerId, organizationId, { name: "Front desk sync",
      branchId: branchA, scopes: ["bookings:read", "availability:read"] });
    const [stored] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    expect(stored.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(key.secret);
    expect(JSON.stringify(await listApiKeys(db, ownerId, organizationId))).not.toContain(key.secret);
    expect(await authenticateApiKey(db, `Bearer ${key.secret}`, "bookings:write")).toMatchObject({ ok: false, reason: "WRONG_SCOPE" });
    expect(await authenticateApiKey(db, "Bearer sltr_invalid", "bookings:read")).toMatchObject({ ok: false, reason: "INVALID_KEY" });
    expect(await authenticateApiKey(db, `Bearer ${key.secret}`, "bookings:read", 1_000, 1))
      .toMatchObject({ ok: true, organizationId, branchId: branchA });
    expect(await authenticateApiKey(db, `Bearer ${key.secret}`, "bookings:read", 1_001, 1))
      .toMatchObject({ ok: false, reason: "RATE_LIMITED" });
    await revokeApiKey(db, ownerId, organizationId, key.id);
    expect(await authenticateApiKey(db, `Bearer ${key.secret}`, "bookings:read"))
      .toMatchObject({ ok: false, reason: "INVALID_KEY" });
    await expect(createApiKey(db, ownerId, organizationId, { name: "Other branch", branchId: otherBranch,
      scopes: ["bookings:read"] })).rejects.toThrow("Branch not found");
    await expect(listApiKeys(db, outsiderId, organizationId)).rejects.toThrow("Permission denied");
  });

  it("requires real DNS proof and does not activate verified custom domains", async () => {
    expect(() => normalizeCustomHostname("localhost")).toThrow();
    expect(() => normalizeCustomHostname("127.0.0.1")).toThrow();
    expect(() => normalizeCustomHostname("*.example.com")).toThrow();
    const result = await createTenantDomain(db, ownerId, organizationId, "Booking.Example.Com");
    expect(result.domain.hostname).toBe("booking.example.com");
    expect(result.domain.isActive).toBe(false);
    await expect(createTenantDomain(db, ownerId, organizationId, "booking.example.com")).rejects.toThrow();
    await expect(verifyTenantDomain(db, outsiderId, organizationId, result.domain.id)).rejects.toThrow("Permission denied");
    expect(await verifyTenantDomain(db, ownerId, organizationId, result.domain.id,
      async () => [["slotra-verification=incorrect"]])).toMatchObject({ verified: false });
    const verified = await verifyTenantDomain(db, ownerId, organizationId, result.domain.id,
      async () => [[result.dnsValue]]);
    expect(verified.verified).toBe(true);
    const [stored] = await db.select().from(schema.tenantDomains).where(eq(schema.tenantDomains.id, result.domain.id));
    expect(stored.status).toBe("VERIFIED");
    expect(stored.isActive).toBe(false);
  });

  it("gates white-label controls and keeps branding organization-scoped", async () => {
    const input = { displayName: "Pro Venue", description: "Play at our courts", color: "#176b5b",
      logoUrl: "https://example.com/logo.png", coverImageUrl: "", hidePoweredBy: true };
    await updateProBranding(db, ownerId, organizationId, input);
    const [venue] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
    expect(venue.hidePoweredBy).toBe(true);
    const [other] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, otherOrganizationId));
    expect(other.hidePoweredBy).toBe(false);
    await expect(updateProBranding(db, outsiderId, organizationId, input)).rejects.toThrow("Permission denied");
    await db.update(schema.organizations).set({ planCode: "BUSINESS" }).where(eq(schema.organizations.id, organizationId));
    await expect(updateProBranding(db, ownerId, organizationId, input)).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
  });

  it("queues signed, idempotent webhook records without sending externally", async () => {
    await db.update(schema.organizations).set({ planCode: "PRO" }).where(eq(schema.organizations.id, organizationId));
    expect(() => safeWebhookUrl("http://127.0.0.1/hook")).toThrow();
    const created = await createWebhookEndpoint(db, ownerId, organizationId, { name: "Operations",
      url: "https://example.com/hook", eventTypes: ["booking.created"] });
    expect(signWebhookPayload(created.secret, "{}", 1000)).toMatch(/^t=1000,v1=[a-f0-9]{64}$/);
    const eventId = await queueOutboundEvent(db, organizationId, "booking.created", null,
      "booking.created:test-one", { bookingId: "safe-test" });
    expect(eventId).toBeTruthy();
    expect(await queueOutboundEvent(db, organizationId, "booking.created", null,
      "booking.created:test-one", { bookingId: "safe-test" })).toBeNull();
    const deliveries = await listWebhookDeliveries(db, ownerId, organizationId, created.endpoint.id);
    expect(deliveries).toHaveLength(1);
    const attempt = await recordWebhookAttempt(db, organizationId, deliveries[0].id, 503);
    expect(attempt).toMatchObject({ success: false, attempt: 1 });
    expect((await listWebhookDeliveries(db, ownerId, organizationId, created.endpoint.id))[0].status).toBe("PENDING");
    await recordWebhookAttempt(db, organizationId, deliveries[0].id, 204);
    expect((await listWebhookDeliveries(db, ownerId, organizationId, created.endpoint.id))[0].status).toBe("SUCCEEDED");
    await setWebhookActive(db, ownerId, organizationId, created.endpoint.id, false);
    await queueOutboundEvent(db, organizationId, "booking.created", null, "booking.created:test-two", {});
    expect(await listWebhookDeliveries(db, ownerId, organizationId, created.endpoint.id)).toHaveLength(1);
    await expect(queueTestWebhook(db, ownerId, organizationId, created.endpoint.id)).rejects.toThrow("Webhook not found");
    await expect(listWebhookDeliveries(db, outsiderId, organizationId, created.endpoint.id)).rejects.toThrow("Permission denied");
    await setWebhookActive(db, ownerId, organizationId, created.endpoint.id, true);
    expect(await queueTestWebhook(db, ownerId, organizationId, created.endpoint.id)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
