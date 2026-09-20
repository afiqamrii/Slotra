import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { handleSandboxUpgradeCallback, reconcileSandboxUpgrade, sandboxUpgradeStatus,
  startSandboxProfessionalUpgrade } from "@/lib/plan-upgrade-service";

describe("ToyyibPay sandbox Professional upgrade", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client: postgres, schema });
  const secret = "sandbox-plan-test-secret";
  let ownerId = "", adminId = "", orgId = "", otherId = "", attemptId = "";
  const billCode = "PlanBill9";
  const now = new Date("2026-10-06T01:00:00Z");
  beforeAll(async () => {
    for (const file of ["0000_talented_smiling_tiger", "0001_stormy_triathlon", "0002_funny_iceman",
      "0003_panoramic_gravity", "0004_flashy_enchantress", "0005_soft_wrecker", "0006_graceful_miek",
      "0007_flaky_madelyne_pryor", "0008_worthless_expediter", "0009_steady_stephen_strange",
      "0010_white_dragon_man", "0011_broken_dragon_man", "0012_massive_marvel_zombies",
      "0013_rare_doctor_faustus", "0014_green_chronomancer", "0015_chubby_psynapse", "0016_lumpy_spirit"]) {
      for (const statement of readFileSync(resolve(`drizzle/${file}.sql`), "utf8")
        .split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
    }
    const people = await db.insert(schema.users).values([
      { name: "Owner", email: "plan-owner@example.test" },
      { name: "Admin", email: "plan-admin@example.test" },
    ]).returning();
    [ownerId, adminId] = people.map(person => person.id);
    const orgs = await db.insert(schema.organizations).values([
      { name: "Starter venue", slug: "starter-plan-venue" },
      { name: "Other venue", slug: "other-plan-venue" },
    ]).returning();
    [orgId, otherId] = orgs.map(org => org.id);
    await db.insert(schema.organizationMembers).values([
      { organizationId: orgId, userId: ownerId, role: "OWNER" },
      { organizationId: orgId, userId: adminId, role: "ADMIN" },
      { organizationId: otherId, userId: ownerId, role: "OWNER" },
    ]);
    vi.stubEnv("ENABLE_TOYYIBPAY_SANDBOX", "true");
    vi.stubEnv("TOYYIBPAY_SANDBOX_SCOPE", "ALL_TEST_VENUES");
    vi.stubEnv("TOYYIBPAY_SANDBOX_SECRET_KEY", secret);
    vi.stubEnv("TOYYIBPAY_SANDBOX_CATEGORY_CODE", "testcat9");
  }, 30000);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { vi.unstubAllEnvs(); await postgres.close(); });
  const fakeBill = vi.fn(async (input: { organizationId: string }) => {
    const code = input.organizationId === otherId ? "PlanBill8" : billCode;
    return { billCode: code, checkoutUrl: `https://dev.toyyibpay.com/${code}` };
  });
  function providerRows(status: "1" | "2" | "3", id: string, amount = "129.00") {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
      billpaymentStatus: status, billpaymentAmount: amount,
      billExternalReferenceNo: id, billpaymentInvoiceNo: "TEST-INVOICE-1",
    }]), { status: 200 })));
  }
  it("allows only a Starter owner to initiate the centralized RM129 sandbox test", async () => {
    await expect(startSandboxProfessionalUpgrade(db, orgId, adminId, "0123456789", now, fakeBill))
      .rejects.toThrow("Only an owner");
    await expect(startSandboxProfessionalUpgrade(db, otherId, adminId, "0123456789", now, fakeBill))
      .rejects.toThrow("Only an owner");
    await expect(startSandboxProfessionalUpgrade(db, orgId, ownerId, "bad", now, fakeBill)).rejects.toThrow();
    const started = await startSandboxProfessionalUpgrade(db, orgId, ownerId, "0123456789", now, fakeBill);
    attemptId = started.id;
    expect(started.checkoutUrl).toBe(`https://dev.toyyibpay.com/${billCode}`);
    expect(fakeBill).toHaveBeenCalledWith(expect.objectContaining({ attemptId, organizationId: orgId, amountMinor: 12900 }));
    expect((await sandboxUpgradeStatus(db, orgId, attemptId)).status).toBe("PROCESSING");
    await expect(sandboxUpgradeStatus(db, otherId, attemptId)).rejects.toThrow("not found");
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].planCode).toBe("STARTER");
  });
  it("reuses an active bill and never upgrades from browser return or an unverified amount", async () => {
    const existing = await startSandboxProfessionalUpgrade(db, orgId, ownerId, "0123456789", now, fakeBill);
    expect(existing.id).toBe(attemptId);
    expect(fakeBill).not.toHaveBeenCalled();
    providerRows("1", attemptId, "79.00");
    expect((await reconcileSandboxUpgrade(db, attemptId)).status).toBe("PROCESSING");
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].planCode).toBe("STARTER");
  });
  it("rejects an invalid callback signature and activates only after a signed, independently verified payment", async () => {
    providerRows("1", attemptId);
    const invalid = new URLSearchParams({ order_id: attemptId, billcode: billCode,
      status: "1", refno: "TEST-REF", hash: "00000000000000000000000000000000" }).toString();
    await expect(handleSandboxUpgradeCallback(db, invalid)).rejects.toThrow("Invalid ToyyibPay callback");
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].planCode).toBe("STARTER");
    const hash = createHash("md5").update(secret + "1" + attemptId + "TEST-REF" + "ok").digest("hex");
    const valid = new URLSearchParams({ order_id: attemptId, billcode: billCode,
      status: "1", refno: "TEST-REF", hash }).toString();
    expect(await handleSandboxUpgradeCallback(db, valid)).toMatchObject({ status: "PAID", duplicate: false });
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].planCode).toBe("PROFESSIONAL");
    expect(await handleSandboxUpgradeCallback(db, valid)).toMatchObject({ status: "PAID", duplicate: true });
    await expect(startSandboxProfessionalUpgrade(db, orgId, ownerId, "0123456789", now, fakeBill))
      .rejects.toThrow("Only Starter");
  });
  it("keeps a failed sandbox payment on Starter and records the failed attempt", async () => {
    const second = await startSandboxProfessionalUpgrade(db, otherId, ownerId, "0123456789", now, fakeBill);
    providerRows("3", second.id);
    expect(await reconcileSandboxUpgrade(db, second.id)).toMatchObject({ status: "FAILED", duplicate: false });
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, otherId)))[0].planCode).toBe("STARTER");
    expect((await sandboxUpgradeStatus(db, otherId, second.id)).status).toBe("FAILED");
  });
});
