import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { payments } from "@/db/schema";
import { publicConfirmation } from "@/lib/public-booking";
import { reconcileToyyibSandboxPayment } from "@/lib/toyyibpay-service";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const paymentId = z.uuid().safeParse(new URL(request.url).searchParams.get("paymentId"));
  const fallback = new URL(`/book/${encodeURIComponent(organizationSlug)}`, request.url);
  if (!paymentId.success) return NextResponse.redirect(fallback);
  const name = "slotra_checkout_" + paymentId.data;
  const token = (await cookies()).get(name)?.value;
  if (!token) return NextResponse.redirect(fallback);
  const booking = await publicConfirmation(getDb(), organizationSlug, token);
  if (!booking) return NextResponse.redirect(fallback);
  const [payment] = await getDb().select({ id: payments.id }).from(payments).where(and(
    eq(payments.id, paymentId.data), eq(payments.organizationId, booking.venue.id),
    eq(payments.bookingId, booking.id), eq(payments.provider, "TOYYIBPAY_SANDBOX"))).limit(1);
  if (!payment) return NextResponse.redirect(fallback);
  // Ignore ToyyibPay's browser status_id. Only its independently fetched transaction may change state.
  try { await reconcileToyyibSandboxPayment(getDb(), paymentId.data); } catch { /* Confirmation remains pending. */ }
  const response = NextResponse.redirect(new URL(
    `/book/${encodeURIComponent(organizationSlug)}/confirmation/${token}`, request.url), { status: 303 });
  response.cookies.set({ name, value: "", path: `/book/${organizationSlug}/payment-return`, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}