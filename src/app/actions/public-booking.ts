"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { payments } from "@/db/schema";
import { testPaymentsEnabled } from "@/lib/payment-policy";
import { handleTestWebhook, testEvent } from "@/lib/payment-service";
import { signTestEvent } from "@/lib/payment-providers";
import { reconcileToyyibSandboxPayment } from "@/lib/toyyibpay-service";
import { BookingError } from "@/lib/booking-availability";
import { checkPublicRateLimit, publicAvailability, publicConfirmation, submitPublicBooking } from "@/lib/public-booking";

async function visitorKey() {
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-real-ip") || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}
function friendlyError(error: unknown) {
  if (error instanceof BookingError) {
    if (error.code === "CONFLICT" || error.code === "BLOCKED") return "That slot was just booked. Please choose another available time.";
    if (error.code === "ADVANCE_WINDOW" || error.code === "CLOSED" || error.code === "RESOURCE_INACTIVE") return "That time is no longer available. Please choose another.";
    if (error.code === "RATE_LIMITED") return error.message;
    if (error.code === "BOOKING_LIMIT_REACHED") return "This venue cannot accept new bookings right now. Please contact the venue.";
    if (error.code === "PRICE_NOT_CONFIGURED") return "This sport is not ready for online booking yet.";
    if (error.code === "PAYMENT_UNAVAILABLE") return "We could not start payment. Your account has not been charged. Please contact the venue.";
    if (error.code === "PRICE_CHANGED") return "The price changed. Please choose your time again and review the new price.";
    return "Please check your selection and try again.";
  }
  if (error instanceof ZodError) return error.issues[0]?.message || "Please check the details you entered.";
  return "We could not complete this request. Please try again in a moment.";
}
export async function publicAvailabilityAction(slug: string, input: {
  sportId: string; localDate: string; durationMinutes: number;
}) {
  try {
    await checkPublicRateLimit(getDb(), `availability:${await visitorKey()}`, 180, 300_000);
    const grid = await publicAvailability(getDb(), slug, input);
    return { grid, error: null };
  } catch (error) { return { grid: null, error: friendlyError(error) }; }
}
export async function submitPublicBookingAction(slug: string, input: unknown) {
  try {
    const key = await visitorKey();
    await checkPublicRateLimit(getDb(), `submit:${key}`, 8, 600_000);
    if (input && typeof input === "object" && "phone" in input && typeof input.phone === "string") {
      const contact = createHash("sha256").update(input.phone.replace(/[^+0-9]/g, "")).digest("hex");
      await checkPublicRateLimit(getDb(), `contact:${slug}:${contact}`, 4, 3_600_000);
    }
    const result = await submitPublicBooking(getDb(), slug, input);
    if (result.checkoutUrl && result.paymentId) (await cookies()).set({
      name: "slotra_checkout_" + result.paymentId, value: result.token, httpOnly: true,
      sameSite: "lax", secure: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
      path: "/book/" + slug + "/payment-return", maxAge: 1800,
    });
    revalidatePath("/book/" + slug);
    revalidatePath("/bookings");
    revalidatePath("/calendar");
    revalidatePath("/available-now");
    revalidatePath("/dashboard");
    return { token: result.token, checkoutUrl: result.checkoutUrl, error: null };
  } catch (error) { return { token: null, checkoutUrl: null, error: friendlyError(error) }; }
}



export async function checkToyyibSandboxPaymentAction(slug: string, token: string) {
  try {
    await checkPublicRateLimit(getDb(), `sandbox-status:${await visitorKey()}:${token}`, 8, 300_000);
    const confirmation = await publicConfirmation(getDb(), slug, token);
    if (!confirmation) return { error: "This booking link is unavailable." };
    const payment = confirmation.paymentHistory.find(item => item.provider === "TOYYIBPAY_SANDBOX" &&
      item.providerPaymentId);
    if (!payment) return { error: "No sandbox payment is ready to check." };
    await reconcileToyyibSandboxPayment(getDb(), payment.id);
    revalidatePath(`/book/${slug}/confirmation/${token}`);
    return { error: null };
  } catch { return { error: "Payment confirmation is still pending. Please try again shortly." }; }
}
export async function simulateTestPaymentAction(slug: string, token: string, outcome: "PAID" | "FAILED" | "PROCESSING") {
  if (!testPaymentsEnabled() || !process.env.TEST_PAYMENT_WEBHOOK_SECRET)
    return { error: "Test payments are unavailable." };
  try {
    await checkPublicRateLimit(getDb(), "test-payment:" + await visitorKey() + ":" + token, 8, 600_000);
    const confirmation = await publicConfirmation(getDb(), slug, token);
    if (!confirmation || confirmation.status !== "AWAITING_PAYMENT") return { error: "This checkout is no longer active." };
    const [payment] = await getDb().select({ id: payments.id }).from(payments).where(and(
      eq(payments.organizationId, confirmation.venue.id), eq(payments.bookingId, confirmation.id),
      eq(payments.provider, "TEST"))).limit(1);
    if (!payment) return { error: "Test payment not found." };
    const raw = testEvent(payment.id, outcome);
    const signature = signTestEvent(raw, process.env.TEST_PAYMENT_WEBHOOK_SECRET);
    await handleTestWebhook(getDb(), raw, signature);
    revalidatePath("/book/" + slug + "/confirmation/" + token);
    revalidatePath("/bookings/" + confirmation.id);
    revalidatePath("/bookings");
    revalidatePath("/calendar");
    return { error: null };
  } catch { return { error: "Could not simulate this payment. Please retry." }; }
}

