import { Temporal } from "@js-temporal/polyfill";
import { BookingError } from "@/lib/booking-availability";

export function localWallTime(date: string, time: string, timezone: string, nextDay = false) {
  try {
    const day = Temporal.PlainDate.from(date).add({ days: nextDay ? 1 : 0 });
    const clock = Temporal.PlainTime.from(time);
    const instant = Temporal.ZonedDateTime.from({
      timeZone: timezone, year: day.year, month: day.month, day: day.day,
      hour: clock.hour, minute: clock.minute,
    }, { disambiguation: "reject" });
    return new Date(Number(instant.epochMilliseconds));
  } catch {
    throw new BookingError("INVALID_LOCAL_TIME", "Choose an unambiguous local date and time for this branch");
  }
}
