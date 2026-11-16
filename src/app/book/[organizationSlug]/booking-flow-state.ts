import type { PublicGrid, PublicVenue } from "@/lib/public-booking";

export type TimeOfDay = "all" | "morning" | "afternoon" | "evening";

/** Presentation filters only: availability and prices always come from the server. */
export function filterBookingTimes(times: PublicGrid["times"], timezone: string,
  timeOfDay: TimeOfDay, availableOnly: boolean) {
  const formatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone });
  return times.filter(row => {
    if (availableOnly && !row.options.some(option => option.available)) return false;
    if (timeOfDay === "all") return true;
    const hour = Number(formatter.format(new Date(row.startAt)));
    return timeOfDay === "morning" ? hour < 12 : timeOfDay === "afternoon" ? hour >= 12 && hour < 18 : hour >= 18;
  });
}

/** Resolve the scene only against the currently displayed server grid. */
export function resolveVenueSelection(times: PublicGrid["times"], spaces: PublicGrid["spaces"],
  preferredStartAt?: string | null, preferredResourceId?: string | null) {
  const row = times.find(item => item.startAt === preferredStartAt) ??
    times.find(item => item.options.some(option => option.available)) ?? times[0];
  const space = spaces.find(item => item.id === preferredResourceId) ??
    spaces.find(item => row?.options.some(option => option.resourceId === item.id && option.available)) ?? spaces[0];
  const option = row?.options.find(item => item.resourceId === space?.id);
  return { row, space, option };
}

export function availabilityLabel(option: PublicGrid["times"][number]["options"][number] | undefined) {
  if (option?.available) return "Available";
  if (option?.reason === "CONFLICT") return "Full";
  if (option?.reason === "BLOCKED") return "Blocked";
  if (option?.reason === "CLOSED") return "Closed";
  if (option?.reason === "INVALID_DURATION") return "Duration unavailable";
  if (option?.reason === "ADVANCE_WINDOW") return "Outside booking window";
  return "Unavailable";
}

export function selectablePayments(options: PublicVenue["paymentOptions"],
  paymentMode: PublicVenue["paymentMode"], dueNowMinor: number | null | undefined) {
  return options.filter(option => option.value !== "ONLINE" ||
    paymentMode !== "TOYYIBPAY_SANDBOX" || (dueNowMinor ?? 0) >= 100);
}

export function resolvePaymentChoice(options: PublicVenue["paymentOptions"], choice: "PAY_AT_VENUE" | "ONLINE") {
  return options.some(option => option.value === choice) ? choice : options[0]?.value;
}
