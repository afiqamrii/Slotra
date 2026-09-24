import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  createAutomationWorkflow, listAutomationExecutions, listAutomationWorkflows,
  runDueBusinessAutomations, setAutomationActive,
} from "@/lib/business-automations";
import { DevelopmentWhatsAppProvider, sendWhatsAppTemplate, whatsappConnectionState } from "@/lib/whatsapp-provider";
import { POST as runAutomationsRoute } from "@/app/api/internal/run-business-automations/route";

describe("Business automations and WhatsApp architecture", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const now = new Date("2026-10-04T00:00:00Z");
  let ownerId = "", viewerId = "", orgId = "", otherOrgId = "", starterOrgId = "";
  let branchId = "", resourceId = "", secondResourceId = "", dueBookingId = "", inactiveCustomerId = "";

  beforeAll(async () => {
    const entries = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"))
      .entries as { tag: string }[];
    for (const { tag } of entries) {
      const migration = readFileSync(resolve(`drizzle/${tag}.sql`), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean))
        await postgres.exec(statement);
    }
    const users = await db.insert(schema.users).values([
      { name: "Automation Owner", email: "automation-owner@example.test" },
      { name: "Read Only", email: "automation-viewer@example.test" },
    ]).returning();
    [ownerId, viewerId] = users.map(row => row.id);
    const venues = await db.insert(schema.organizations).values([
      { name: "Business Venue", slug: "automation-business", planCode: "BUSINESS" },
      { name: "Other Business", slug: "automation-other", planCode: "BUSINESS" },
      { name: "Starter Venue", slug: "automation-starter" },
    ]).returning();
    [orgId, otherOrgId, starterOrgId] = venues.map(row => row.id);
    await db.insert(schema.organizationMembers).values([
      { organizationId: orgId, userId: ownerId, role: "OWNER" },
      { organizationId: orgId, userId: viewerId, role: "VIEWER" },
      { organizationId: starterOrgId, userId: ownerId, role: "OWNER" },
    ]);
    branchId = (await db.insert(schema.branches).values({
      organizationId: orgId, name: "Main", slug: "main", timezone: "Asia/Kuala_Lumpur",
    }).returning())[0].id;
    const [sport] = await db.select({ id: schema.sportTypes.id }).from(schema.sportTypes).limit(1);
    const spaces = await db.insert(schema.resources).values([
      { organizationId: orgId, branchId, sportTypeId: sport.id, name: "Court 1" },
      { organizationId: orgId, branchId, sportTypeId: sport.id, name: "Court 2" },
    ]).returning();
    [resourceId, secondResourceId] = spaces.map(row => row.id);
    const people = await db.insert(schema.customers).values([
      { organizationId: orgId, name: "Email Player", phone: "+60111111111", email: "player@example.test" },
      { organizationId: orgId, name: "Phone Only", phone: "+60122222222" },
      { organizationId: orgId, name: "Former Player", phone: "+60133333333", email: "former@example.test" },
    ]).returning();
    inactiveCustomerId = people[2].id;
    const saved = await db.insert(schema.bookings).values([
      { organizationId: orgId, branchId, resourceId, customerId: people[0].id,
        bookingReference: "AUTO-ONE", startAt: new Date("2026-10-05T00:00:00Z"),
        endAt: new Date("2026-10-05T01:00:00Z"), status: "CONFIRMED", source: "STAFF",
        subtotal: 2500, totalAmount: 2500, currency: "MYR" },
      { organizationId: orgId, branchId, resourceId: secondResourceId, customerId: people[1].id,
        bookingReference: "AUTO-TWO", startAt: new Date("2026-10-04T23:50:00Z"),
        endAt: new Date("2026-10-05T00:50:00Z"), status: "CONFIRMED", source: "STAFF",
        subtotal: 2500, totalAmount: 2500, currency: "MYR" },
      { organizationId: orgId, branchId, resourceId, customerId: people[2].id,
        bookingReference: "AUTO-OLD", startAt: new Date("2026-08-20T00:00:00Z"),
        endAt: new Date("2026-08-20T01:00:00Z"), status: "COMPLETED", source: "STAFF",
        subtotal: 2500, totalAmount: 2500, currency: "MYR" },
    ]).returning();
    dueBookingId = saved[0].id;
  }, 120000);
  afterAll(async () => postgres.close());

  it("enforces role, plan and tenant boundaries for workflow management", async () => {
    await expect(createAutomationWorkflow(db, ownerId, starterOrgId, "REMINDER_24_HOURS"))
      .rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(createAutomationWorkflow(db, viewerId, orgId, "REMINDER_24_HOURS"))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(createAutomationWorkflow(db, ownerId, otherOrgId, "REMINDER_24_HOURS"))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const workflow = await createAutomationWorkflow(db, ownerId, orgId, "REMINDER_24_HOURS");
    expect((await createAutomationWorkflow(db, ownerId, orgId, "REMINDER_24_HOURS")).id).toBe(workflow.id);
    await expect(setAutomationActive(db, viewerId, orgId, workflow.id, false))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(setAutomationActive(db, ownerId, otherOrgId, workflow.id, false))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await listAutomationWorkflows(db, ownerId, orgId)).toHaveLength(1);
  });

  it("schedules reminders for confirmed bookings and records preview/skip only once", async () => {
    const first = await runDueBusinessAutomations(db, now);
    expect(first).toMatchObject({ previews: 1, skipped: 1, sent: 0 });
    const executions = await listAutomationExecutions(db, ownerId, orgId);
    expect(executions).toHaveLength(2);
    expect(executions.find(row => row.execution.bookingId === dueBookingId)?.execution.status)
      .toBe("DEV_PREVIEW");
    const second = await runDueBusinessAutomations(db, now);
    expect(second).toMatchObject({ previews: 0, skipped: 0, sent: 0 });
    expect(await listAutomationExecutions(db, ownerId, orgId)).toHaveLength(2);
  });

  it("does not remind cancelled or rescheduled old slots", async () => {
    const [workflow] = await listAutomationWorkflows(db, ownerId, orgId);
    await setAutomationActive(db, ownerId, orgId, workflow.id, false);
    const paused = await runDueBusinessAutomations(db, now);
    expect(paused.previews).toBe(0);
    await setAutomationActive(db, ownerId, orgId, workflow.id, true);
    await db.update(schema.bookings).set({ status: "CANCELLED" })
      .where(eq(schema.bookings.id, dueBookingId));
    const afterCancel = await runDueBusinessAutomations(db, new Date(now.getTime() + 1));
    expect(afterCancel.sent).toBe(0);
    expect(afterCancel.previews).toBe(0);
  });

  it("tags only formerly active customers once, without crossing tenants", async () => {
    await createAutomationWorkflow(db, ownerId, orgId, "INACTIVE_30_DAYS");
    const result = await runDueBusinessAutomations(db, now);
    expect(result.tagged).toBe(1);
    const tags = await db.select().from(schema.customerTags).where(and(
      eq(schema.customerTags.organizationId, orgId), eq(schema.customerTags.customerId, inactiveCustomerId)));
    expect(tags.map(row => row.label)).toEqual(["Inactive"]);
    const repeat = await runDueBusinessAutomations(db, now);
    expect(repeat.tagged).toBe(0);
    expect(await db.select().from(schema.customerTags).where(eq(schema.customerTags.organizationId, otherOrgId)))
      .toHaveLength(0);
  });

  it("stops active workflows after a plan downgrade", async () => {
    await db.update(schema.organizations).set({ planCode: "PROFESSIONAL" })
      .where(eq(schema.organizations.id, orgId));
    const result = await runDueBusinessAutomations(db, now);
    expect(result.workflows).toBe(0);
    await db.update(schema.organizations).set({ planCode: "BUSINESS" })
      .where(eq(schema.organizations.id, orgId));
  });

  it("never presents development WhatsApp simulation as a delivered message", async () => {
    const message = { event: "BOOKING_REMINDER" as const, recipient: "+60123456789",
      templateName: "booking_reminder", parameters: ["Court 1", "Tomorrow"],
      idempotencyKey: crypto.randomUUID(),
      consent: { verified: true as const, source: "customer_opt_in", recordedAt: now } };
    const success = await sendWhatsAppTemplate(message, new DevelopmentWhatsAppProvider("SUCCESS"));
    expect(success).toMatchObject({ status: "DEV_SIMULATED_SUCCESS", providerMessageId: null });
    expect((await sendWhatsAppTemplate(message, new DevelopmentWhatsAppProvider("FAILURE"))).status)
      .toBe("DEV_SIMULATED_FAILURE");
    expect((await sendWhatsAppTemplate(message, new DevelopmentWhatsAppProvider("DELAYED"))).status)
      .toBe("DEV_SIMULATED_DELAYED");
    await expect(sendWhatsAppTemplate({ ...message, consent: { verified: false } },
      new DevelopmentWhatsAppProvider("SUCCESS"))).rejects.toThrow();
    await expect(sendWhatsAppTemplate(message, { kind: "META_CLOUD",
      sendTemplate: async () => ({ status: "SUBMITTED", providerMessageId: "fake", reason: null }),
    })).rejects.toThrow("verified consent");
    expect(whatsappConnectionState().mode).toBe("NOT_CONFIGURED");
    vi.stubEnv("WHATSAPP_DEV_MODE", "SUCCESS");
    vi.stubEnv("NODE_ENV", "production");
    expect(whatsappConnectionState().mode).toBe("NOT_CONFIGURED");
    vi.unstubAllEnvs();
  });

  it("rejects scheduler calls without a configured secret or with a bad token", async () => {
    const request = (authorization: string) => new Request("http://localhost/api/internal/run-business-automations", {
      method: "POST", headers: { authorization },
    });
    vi.stubEnv("BUSINESS_AUTOMATION_RUNNER_SECRET", "too-short");
    expect((await runAutomationsRoute(request("Bearer too-short"))).status).toBe(503);
    vi.stubEnv("BUSINESS_AUTOMATION_RUNNER_SECRET", "s".repeat(32));
    expect((await runAutomationsRoute(request("Bearer wrong"))).status).toBe(401);
    vi.unstubAllEnvs();
  });
});
