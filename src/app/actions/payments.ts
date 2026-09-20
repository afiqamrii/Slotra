"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { BookingError } from "@/lib/booking-availability";
import { connectTestAccount, disconnectTestAccount, connectToyyibSandboxAccount, disconnectToyyibSandboxAccount, recordManualPayment, requestRefund, savePaymentPolicy } from "@/lib/payment-service";

function message(error: unknown) {
  if (error instanceof BookingError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the payment details.";
  return "Payment action could not be completed. Please try again.";
}
function refresh() {
  revalidatePath("/settings/payments");
  revalidatePath("/payments");
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}
export async function savePaymentSettingsAction(raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    await savePaymentPolicy(getDb(), session.user.id, organization.organizationId, raw);
    refresh();
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}
export async function connectTestProviderAction() {
  const { session, organization } = await requireOrganizationMember();
  try {
    await connectTestAccount(getDb(), session.user.id, organization.organizationId);
    refresh();
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}
export async function disconnectTestProviderAction() {
  const { session, organization } = await requireOrganizationMember();
  try {
    await disconnectTestAccount(getDb(), session.user.id, organization.organizationId);
    refresh();
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}
export async function connectToyyibSandboxAction() {
  const { session, organization } = await requireOrganizationMember();
  try {
    await connectToyyibSandboxAccount(getDb(), session.user.id, organization.organizationId);
    refresh();
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}
export async function disconnectToyyibSandboxAction() {
  const { session, organization } = await requireOrganizationMember();
  try {
    await disconnectToyyibSandboxAccount(getDb(), session.user.id, organization.organizationId);
    refresh();
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}
export async function recordManualPaymentAction(raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const payment = await recordManualPayment(getDb(), session.user.id, organization.organizationId, raw);
    refresh(); revalidatePath("/bookings/" + payment.bookingId);
    return { error: null };
  } catch (error) { return { error: message(error) }; }
}
export async function requestRefundAction(raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const paymentId = z.object({ paymentId: z.uuid() }).parse(raw).paymentId;
    const refund = await requestRefund(getDb(), session.user.id, organization.organizationId, raw);
    refresh(); revalidatePath("/bookings/" + refund.bookingId);
    return { error: null, paymentId };
  } catch (error) { return { error: message(error), paymentId: null }; }
}

