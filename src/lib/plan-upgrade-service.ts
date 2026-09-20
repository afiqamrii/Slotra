import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { organizations, planUpgradeAttempts, users } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { planCatalog } from "@/lib/plan-catalog";
import { createToyyibSandboxPlanBill, sandboxCheckoutUrl, toyyibSandboxConfig,
  verifiedToyyibTransaction, verifyToyyibCallback } from "@/lib/toyyibpay-sandbox";

const phoneSchema = z.string().trim().regex(/^\+?[0-9\s()-]{9,24}$/, "Enter a valid contact number.");
export const professionalSandboxPriceMinor = Number(planCatalog.PROFESSIONAL.price) * 100;
type BillInput = Parameters<typeof createToyyibSandboxPlanBill>[0];
type BillFactory = (input: BillInput) => Promise<{ billCode: string; checkoutUrl: string }>;

export async function startSandboxProfessionalUpgrade(db: BookingDatabase, organizationId: string,
  actorId: string, rawPhone: unknown, now = new Date(), createBill: BillFactory = createToyyibSandboxPlanBill) {
  const membership = await authorizedMembership(db, actorId, organizationId, "organization:update");
  if (membership?.role !== "OWNER")
    throw new Error("Only an owner can change the plan.");
  const phone = phoneSchema.parse(rawPhone);
  if (!toyyibSandboxConfig(organizationId)) throw new Error("ToyyibPay sandbox plan testing is unavailable.");
  const [actor] = await db.select({ name: users.name, email: users.email }).from(users)
    .where(eq(users.id, actorId)).limit(1);
  if (!actor) throw new Error("Account not found.");
  const preparation = await db.transaction(async tx => {
    const [venue] = await tx.select({ planCode: organizations.planCode, currency: organizations.currency })
      .from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
    if (!venue || venue.currency !== "MYR" || venue.planCode !== "STARTER")
      throw new Error("Only Starter venues using MYR can test this upgrade.");
    const [active] = await tx.select().from(planUpgradeAttempts).where(and(
      eq(planUpgradeAttempts.organizationId, organizationId),
      eq(planUpgradeAttempts.status, "PROCESSING"))).limit(1);
    if (active && active.expiresAt > now && active.providerBillCode)
      return { existing: true as const, attempt: active };
    if (active) throw new Error("Previous sandbox checkout needs payment review before another attempt.");
    const [pending] = await tx.select().from(planUpgradeAttempts).where(and(
      eq(planUpgradeAttempts.organizationId, organizationId),
      eq(planUpgradeAttempts.status, "PENDING"))).limit(1);
    if (pending && pending.expiresAt > now) throw new Error("A checkout is already starting. Please wait.");
    if (pending) await tx.update(planUpgradeAttempts).set({ status: "EXPIRED", updatedAt: now })
      .where(eq(planUpgradeAttempts.id, pending.id));
    const [attempt] = await tx.insert(planUpgradeAttempts).values({
      organizationId, createdByUserId: actorId, fromPlan: "STARTER", targetPlan: "PROFESSIONAL",
      amountMinor: professionalSandboxPriceMinor, currency: "MYR",
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    }).returning();
    return { existing: false as const, attempt };
  });
  if (preparation.existing) return { id: preparation.attempt.id,
    checkoutUrl: sandboxCheckoutUrl(preparation.attempt.providerBillCode!) };
  const attempt = preparation.attempt;
  try {
    const bill = await createBill({ attemptId: attempt.id, organizationId,
      amountMinor: attempt.amountMinor, payerName: actor.name,
      payerEmail: actor.email, payerPhone: phone, expiresAt: attempt.expiresAt });
    const [linked] = await db.update(planUpgradeAttempts).set({
      providerBillCode: bill.billCode, status: "PROCESSING", updatedAt: new Date(),
    }).where(and(eq(planUpgradeAttempts.organizationId, organizationId), eq(planUpgradeAttempts.id, attempt.id),
      eq(planUpgradeAttempts.status, "PENDING"))).returning({ id: planUpgradeAttempts.id });
    if (!linked) throw new Error("Checkout could not be linked. No plan change was made.");
    return { id: attempt.id, checkoutUrl: bill.checkoutUrl };
  } catch {
    await db.update(planUpgradeAttempts).set({ status: "FAILED", updatedAt: new Date() })
      .where(and(eq(planUpgradeAttempts.organizationId, organizationId), eq(planUpgradeAttempts.id, attempt.id),
        eq(planUpgradeAttempts.status, "PENDING")));
    throw new Error("Could not start the ToyyibPay sandbox checkout. No plan change was made.");
  }
}

export async function sandboxUpgradeStatus(db: BookingDatabase, organizationId: string, attemptId: string) {
  z.uuid().parse(attemptId);
  const [row] = await db.select({ id: planUpgradeAttempts.id, status: planUpgradeAttempts.status,
    targetPlan: planUpgradeAttempts.targetPlan, amountMinor: planUpgradeAttempts.amountMinor,
    providerBillCode: planUpgradeAttempts.providerBillCode, expiresAt: planUpgradeAttempts.expiresAt })
    .from(planUpgradeAttempts).where(and(eq(planUpgradeAttempts.organizationId, organizationId),
      eq(planUpgradeAttempts.id, attemptId))).limit(1);
  if (!row) throw new Error("Upgrade attempt not found.");
  return row;
}

export async function applyVerifiedSandboxUpgrade(db: BookingDatabase, attemptId: string,
  outcome: "PAID" | "FAILED" | "PROCESSING", reference: string | null, now = new Date()) {
  z.uuid().parse(attemptId);
  return db.transaction(async tx => {
    const [lookup] = await tx.select({ organizationId: planUpgradeAttempts.organizationId })
      .from(planUpgradeAttempts).where(eq(planUpgradeAttempts.id, attemptId)).limit(1);
    if (!lookup) throw new Error("Upgrade attempt not found.");
    const [venue] = await tx.select({ planCode: organizations.planCode }).from(organizations)
      .where(eq(organizations.id, lookup.organizationId)).for("update").limit(1);
    const [attempt] = await tx.select().from(planUpgradeAttempts)
      .where(and(eq(planUpgradeAttempts.organizationId, lookup.organizationId),
        eq(planUpgradeAttempts.id, attemptId))).for("update").limit(1);
    if (!venue || !attempt || !attempt.providerBillCode) throw new Error("Upgrade attempt unavailable.");
    if (attempt.status === "PAID") return { status: "PAID" as const, duplicate: true };
    if (attempt.status !== "PROCESSING") return { status: attempt.status, duplicate: true };
    if (outcome === "PROCESSING") return { status: "PROCESSING" as const, duplicate: false };
    if (outcome === "FAILED" || venue.planCode !== attempt.fromPlan) {
      await tx.update(planUpgradeAttempts).set({ status: "FAILED", providerReference: reference,
        verifiedAt: now, updatedAt: now }).where(eq(planUpgradeAttempts.id, attempt.id));
      return { status: "FAILED" as const, duplicate: false };
    }
    await tx.update(organizations).set({ planCode: "PROFESSIONAL", updatedAt: now })
      .where(and(eq(organizations.id, lookup.organizationId), eq(organizations.planCode, "STARTER")));
    await tx.update(planUpgradeAttempts).set({ status: "PAID", providerReference: reference,
      verifiedAt: now, updatedAt: now }).where(eq(planUpgradeAttempts.id, attempt.id));
    return { status: "PAID" as const, duplicate: false };
  });
}

export async function reconcileSandboxUpgrade(db: BookingDatabase, attemptId: string, now = new Date()) {
  z.uuid().parse(attemptId);
  const [attempt] = await db.select().from(planUpgradeAttempts)
    .where(eq(planUpgradeAttempts.id, attemptId)).limit(1);
  if (!attempt || !attempt.providerBillCode || !toyyibSandboxConfig(attempt.organizationId))
    throw new Error("Upgrade attempt unavailable.");
  if (attempt.status === "PAID") return { status: "PAID" as const, duplicate: true };
  if (attempt.status !== "PROCESSING") return { status: attempt.status, duplicate: true };
  const verified = await verifiedToyyibTransaction({ billCode: attempt.providerBillCode,
    paymentId: attempt.id, amountMinor: attempt.amountMinor });
  if (!verified) return { status: "PROCESSING" as const, duplicate: false };
  return applyVerifiedSandboxUpgrade(db, attempt.id, verified.status, verified.providerReference, now);
}

export async function handleSandboxUpgradeCallback(db: BookingDatabase, raw: string) {
  if (raw.length > 4096) throw new Error("Invalid ToyyibPay callback");
  const id = z.uuid().parse(new URLSearchParams(raw).get("order_id"));
  const [attempt] = await db.select({ organizationId: planUpgradeAttempts.organizationId,
    billCode: planUpgradeAttempts.providerBillCode }).from(planUpgradeAttempts)
    .where(eq(planUpgradeAttempts.id, id)).limit(1);
  if (!attempt || !attempt.billCode) throw new Error("Invalid ToyyibPay callback");
  const callback = verifyToyyibCallback(raw, attempt.organizationId);
  if (callback.billcode !== attempt.billCode) throw new Error("Invalid ToyyibPay callback");
  return reconcileSandboxUpgrade(db, id);
}
