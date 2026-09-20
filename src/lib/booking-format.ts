export function bookingDate(value: Date | string, timezone: string, weekday = false) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: timezone, weekday: weekday ? "short" : undefined,
    day: "numeric", month: "short", year: "numeric",
  }).format(new Date(value));
}

export function bookingTime(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

export function bookingMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(amountMinor / 100);
}

export function bookingStatusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, value => value.toUpperCase());
}
