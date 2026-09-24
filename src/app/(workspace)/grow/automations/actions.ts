"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { BookingError } from "@/lib/booking-availability";
import { createAutomationWorkflow, setAutomationActive } from "@/lib/business-automations";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { configuredWhatsAppProvider, sendWhatsAppTemplate } from "@/lib/whatsapp-provider";

function safeMessage(error: unknown) {
  if (error instanceof BookingError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the details.";
  return "Could not save the automation. Please try again.";
}

export async function createAutomationAction(data: FormData) {
  const { session, organization } = await requirePermission("organization:update");
  let error: string | null = null;
  try {
    await createAutomationWorkflow(getDb(), session.user.id, organization.organizationId,
      String(data.get("template") ?? ""));
  } catch (caught) { error = safeMessage(caught); }
  if (error) redirect("/grow/automations?error=" + encodeURIComponent(error));
  revalidatePath("/grow/automations");
  redirect("/grow/automations?saved=1");
}

export async function toggleAutomationAction(data: FormData) {
  const { session, organization } = await requirePermission("organization:update");
  let error: string | null = null;
  try {
    await setAutomationActive(getDb(), session.user.id, organization.organizationId,
      String(data.get("workflowId") ?? ""), data.get("active") === "true");
  } catch (caught) { error = safeMessage(caught); }
  if (error) redirect("/grow/automations?error=" + encodeURIComponent(error));
  revalidatePath("/grow/automations");
  redirect("/grow/automations?saved=1");
}

export async function simulateWhatsAppAction() {
  const { organization } = await requirePermission("organization:update");
  await requireOrganizationFeature(getDb(), organization.organizationId, "WHATSAPP");
  const provider = configuredWhatsAppProvider();
  if (process.env.NODE_ENV === "production" || !provider)
    redirect("/grow/automations?error=" + encodeURIComponent("Development simulator is not configured."));
  const outcome = await sendWhatsAppTemplate({
    event: "BOOKING_REMINDER", recipient: "+60100000000", templateName: "booking_reminder",
    parameters: ["Example venue", "Court 1"], idempotencyKey: crypto.randomUUID(),
    consent: { verified: true, source: "synthetic_development_fixture", recordedAt: new Date() },
  }, provider);
  redirect("/grow/automations?simulation=" + encodeURIComponent(outcome.status));
}
