// Safe shared vocabulary. No server-only modules or credentials in this file.
export const apiScopes = ["bookings:read", "bookings:write", "customers:read", "customers:write",
  "resources:read", "availability:read"] as const;
export type ApiScope = typeof apiScopes[number];

export const outboundEventTypes = ["booking.created", "booking.confirmed", "booking.rescheduled",
  "booking.cancelled", "booking.completed", "payment.paid", "payment.refunded", "customer.created"] as const;
export type OutboundEventType = typeof outboundEventTypes[number];
