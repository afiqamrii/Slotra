"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { checkInBooking } from "@/lib/booking-service";
import { resolveBookingQr } from "@/lib/business-qr";

export async function checkInQrAction(data: FormData) {
  const code = String(data.get("code") ?? "");
  const { session, organization } = await requirePermission("booking:check_in");
  let bookingId: string | null = null;
  try {
    const booking = await resolveBookingQr(getDb(), session.user.id, organization.organizationId, code);
    await checkInBooking(getDb(), session.user.id, organization.organizationId, booking.id);
    bookingId = booking.id;
  } catch {
    redirect("/check-in?code=" + encodeURIComponent(code) + "&error=1");
  }
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  redirect("/bookings/" + bookingId);
}
