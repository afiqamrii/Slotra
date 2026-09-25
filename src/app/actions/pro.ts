"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { postgresErrorCode } from "@/lib/auth";
import { assignCustomRole, createCustomRole, setMemberBranches } from "@/lib/pro-access-service";
import { createTenantDomain, updateProBranding, verifyTenantDomain } from "@/lib/pro-domain-service";
import { createApiKey, revokeApiKey } from "@/lib/pro-api-service";
import { createWebhookEndpoint, queueTestWebhook, setWebhookActive } from "@/lib/pro-webhooks";
import { addCorporateCustomer, createCorporateAccount } from "@/lib/pro-corporate-service";
import { createCorporateBooking } from "@/lib/pro-corporate-service";
import { branches, resources } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { localWallTime } from "@/lib/booking-local-input";

export type ProFormState = { error: string | null; success: string | null; secret?: string | null;
  dnsName?: string | null; dnsValue?: string | null };
const failure = (cause: unknown): ProFormState => ({ error: cause instanceof ZodError
  ? cause.issues[0]?.message ?? "Check the details."
  : postgresErrorCode(cause) === "23505" ? "That name or address is already in use."
    : cause instanceof Error ? cause.message : "Could not save. Try again.", success: null });
const context = async () => {
  const { session, organization } = await requireOrganizationMember();
  return { db: getDb(), actorId: session.user.id, organizationId: organization.organizationId };
};

export async function createRoleAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    await createCustomRole(db, actorId, organizationId, { name: form.get("name"), baseRole: form.get("baseRole"),
      permissions: form.getAll("permissions") });
    revalidatePath("/settings/access");
    return { error: null, success: "Role created." };
  } catch (cause) { return failure(cause); }
}

export async function assignRoleAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    await assignCustomRole(db, actorId, organizationId, String(form.get("memberId")), String(form.get("roleId")));
    revalidatePath("/settings/access");
    return { error: null, success: "Role assigned." };
  } catch (cause) { return failure(cause); }
}

export async function assignBranchesAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    await setMemberBranches(db, actorId, organizationId, { memberId: form.get("memberId"),
      scope: form.get("scope"), branchIds: form.getAll("branchIds") });
    revalidatePath("/settings/access");
    return { error: null, success: "Branch access updated." };
  } catch (cause) { return failure(cause); }
}

export async function saveBrandingAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    await updateProBranding(db, actorId, organizationId, { displayName: form.get("displayName"),
      description: form.get("description"), color: form.get("color"), logoUrl: form.get("logoUrl"),
      coverImageUrl: form.get("coverImageUrl"), hidePoweredBy: form.get("hidePoweredBy") === "on" });
    revalidatePath("/settings/branding");
    return { error: null, success: "Booking page branding updated." };
  } catch (cause) { return failure(cause); }
}

export async function createDomainAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    const result = await createTenantDomain(db, actorId, organizationId, String(form.get("hostname") ?? ""));
    revalidatePath("/settings/branding");
    return { error: null, success: "Domain added. Copy the DNS record now; its value is shown once.",
      dnsName: result.dnsName, dnsValue: result.dnsValue };
  } catch (cause) { return failure(cause); }
}

export async function verifyDomainAction(domainId: string, _state: ProFormState): Promise<ProFormState> {
  void _state;
  const { db, actorId, organizationId } = await context();
  try {
    const result = await verifyTenantDomain(db, actorId, organizationId, domainId);
    revalidatePath("/settings/branding");
    return { error: result.verified ? null : "DNS record not found yet. Check the TXT value and try again.",
      success: result.verified ? "DNS ownership verified. Platform hostname activation is not configured yet." : null };
  } catch (cause) { return failure(cause); }
}

export async function createApiKeyAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    const key = await createApiKey(db, actorId, organizationId, { name: form.get("name"),
      branchId: form.get("branchId") || null, scopes: form.getAll("scopes") });
    revalidatePath("/settings/integrations");
    return { error: null, success: "API key created. Copy it now; it will not be shown again.", secret: key.secret };
  } catch (cause) { return failure(cause); }
}

export async function revokeApiKeyAction(keyId: string, _state: ProFormState): Promise<ProFormState> {
  void _state;
  const { db, actorId, organizationId } = await context();
  try { await revokeApiKey(db, actorId, organizationId, keyId); revalidatePath("/settings/integrations");
    return { error: null, success: "API key revoked." }; }
  catch (cause) { return failure(cause); }
}

export async function createWebhookAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    const result = await createWebhookEndpoint(db, actorId, organizationId, { name: form.get("name"),
      url: form.get("url"), eventTypes: form.getAll("eventTypes") });
    revalidatePath("/settings/integrations");
    return { error: null, success: "Webhook endpoint saved. Live delivery is not enabled yet; copy this signing secret now.",
      secret: result.secret };
  } catch (cause) { return failure(cause); }
}

export async function toggleWebhookAction(endpointId: string, active: boolean, _state: ProFormState): Promise<ProFormState> {
  void _state;
  const { db, actorId, organizationId } = await context();
  try { await setWebhookActive(db, actorId, organizationId, endpointId, active);
    revalidatePath("/settings/integrations"); return { error: null, success: "Webhook setting updated." }; }
  catch (cause) { return failure(cause); }
}

export async function testWebhookAction(endpointId: string, _state: ProFormState): Promise<ProFormState> {
  void _state;
  const { db, actorId, organizationId } = await context();
  try { await queueTestWebhook(db, actorId, organizationId, endpointId);
    revalidatePath("/settings/integrations"); return { error: null,
      success: "Test event queued. External delivery is not enabled, so no request was sent." }; }
  catch (cause) { return failure(cause); }
}

export async function createCorporateAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    await createCorporateAccount(db, actorId, organizationId, { name: form.get("name"),
      billingEmail: form.get("billingEmail"), contactPerson: form.get("contactPerson") || undefined,
      billingTerms: form.get("billingTerms") || undefined,
      monthlyLimitMinor: Math.round(Number(form.get("monthlyLimit")) * 100),
      allowOverage: form.get("allowOverage") === "on" });
    revalidatePath("/corporate"); return { error: null, success: "Corporate account created." };
  } catch (cause) { return failure(cause); }
}

export async function addCorporateCustomerAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try { await addCorporateCustomer(db, actorId, organizationId,
    z.uuid().parse(form.get("accountId")), z.uuid().parse(form.get("customerId")));
    revalidatePath("/corporate"); return { error: null, success: "Customer approved for this account." }; }
  catch (cause) { return failure(cause); }
}

export async function createCorporateBookingAction(_state: ProFormState, form: FormData): Promise<ProFormState> {
  const { db, actorId, organizationId } = await context();
  try {
    const pair = String(form.get("accountCustomer") ?? "").split(":");
    const accountId = z.uuid().parse(pair[0]), customerId = z.uuid().parse(pair[1]);
    const resourceId = z.uuid().parse(form.get("resourceId"));
    const date = z.iso.date().parse(form.get("date"));
    const time = z.string().regex(/^\d{2}:\d{2}$/).parse(form.get("time"));
    const duration = z.coerce.number().int().min(30).max(480).parse(form.get("duration"));
    const [resource] = await db.select({ branchId: resources.branchId, timezone: branches.timezone })
      .from(resources).innerJoin(branches, and(eq(resources.organizationId, branches.organizationId),
        eq(resources.branchId, branches.id))).where(and(eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId))).limit(1);
    if (!resource) throw new Error("Space not found");
    const startAt = localWallTime(date, time, resource.timezone);
    const booking = await createCorporateBooking(db, actorId, organizationId, { accountId, customerId,
      branchId: resource.branchId, resourceId, startAt,
      endAt: new Date(startAt.getTime() + duration * 60_000), notes: String(form.get("notes") ?? "") });
    revalidatePath("/corporate"); revalidatePath("/bookings"); revalidatePath("/calendar");
    return { error: null, success: `Corporate booking ${booking.bookingReference} created.` };
  } catch (cause) { return failure(cause); }
}
