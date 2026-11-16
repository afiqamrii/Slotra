type Filters = Record<string, string | number | undefined>;

/** Keep the selected branch and compatible filters when navigating the list. */
export function bookingListHref(filters: Filters, changes: Filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...changes })) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return `/bookings${query.size ? `?${query}` : ""}`;
}

export function bookingViewHref(filters: Filters, view: string) {
  return bookingListHref(filters, { view, date: undefined, status: undefined, page: undefined });
}
