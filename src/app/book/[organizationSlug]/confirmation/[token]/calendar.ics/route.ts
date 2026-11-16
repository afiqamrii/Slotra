import { getDb } from "@/db/client";
import { publicConfirmation } from "@/lib/public-booking";
import { bookingCalendarFile, canDownloadBookingCalendar } from "@/lib/booking-calendar-file";
import { brand } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function GET(_request: Request, { params }: {
  params: Promise<{ organizationSlug: string; token: string }>;
}) {
  try {
    const { organizationSlug, token } = await params;
    // The existing opaque-token lookup also verifies the venue slug and the booking's own branch.
    const booking = await publicConfirmation(getDb(), organizationSlug, token);
    if (!booking) return new Response("Booking unavailable.", { status: 404, headers: privateHeaders });
    if (!canDownloadBookingCalendar(booking.status)) return new Response("Calendar download is available for confirmed bookings only.", {
      status: 409, headers: privateHeaders,
    });
    return new Response(bookingCalendarFile(booking, brand.name), { headers: {
      ...privateHeaders, "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="booking.ics"',
    } });
  } catch {
    return new Response("Calendar download is temporarily unavailable. Try again shortly.", { status: 503, headers: privateHeaders });
  }
}
