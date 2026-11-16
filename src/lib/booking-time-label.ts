import { Temporal } from "@js-temporal/polyfill";
import { bookingTime } from "./booking-format";

/** Distinguish repeated local times without adding noise to ordinary slot labels. */
export function bookingTimeLabel(value: Date | string, timezone: string): string {
  const instant = new Date(value);
  const label = bookingTime(instant, timezone);
  const zoned = Temporal.Instant.from(instant.toISOString()).toZonedDateTimeISO(timezone);
  const wallTime = zoned.toPlainDateTime();
  const earlier = wallTime.toZonedDateTime(timezone, { disambiguation: "earlier" });
  const later = wallTime.toZonedDateTime(timezone, { disambiguation: "later" });

  return earlier.epochNanoseconds === later.epochNanoseconds
    ? label
    : `${label} (UTC${zoned.offset})`;
}
