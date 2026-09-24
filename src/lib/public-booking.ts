import { createHash, randomBytes } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { basePrices, bookings, branches, customers, operatingHours, organizationSports, organizations, payments, pricingRules, rateLimits, resources, sportTypes } from "@/db/schema";
import { BookingError, evaluateAvailability, loadAvailabilitySnapshot, type BookingDatabase } from "@/lib/booking-availability";
import { effectiveWindows, localDateAt, localDayBounds, queryBounds } from "@/lib/booking-time";
import { createGuestBooking } from "@/lib/booking-service";
import { businessRateForStart } from "@/lib/business-pricing";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { spaceTerm } from "@/lib/space-terminology";
import { connectedCheckoutAccount, getPaymentPolicy } from "@/lib/payment-service";
import { paymentDue } from "@/lib/payment-policy";
import { startToyyibSandboxCheckout } from "@/lib/toyyibpay-service";
import { getBookingUsage } from "@/lib/booking-usage";

const slugInput = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const dateInput = z.iso.date();
const guestInput = z.object({
  resourceId: z.uuid(),
  startAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(30).max(480),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30).regex(/^\+?[0-9()\s-]+$/),
  email: z.email().max(254),
  expectedPriceMinor: z.number().int().nonnegative().max(2_147_483_647),
  website: z.string().max(0).optional(),
  paymentChoice: z.enum(["PAY_AT_VENUE", "ONLINE"]).optional(),
  promoCode: z.string().trim().min(3).max(40).optional(),
});
export type PublicVenue = NonNullable<Awaited<ReturnType<typeof resolvePublicVenue>>>;
export type PublicGrid = Awaited<ReturnType<typeof publicAvailability>>;

export function safePublicColor(color: string | null) {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return "#176b5b";
  const values = [1, 3, 5].map(index => {
    const raw = parseInt(color.slice(index, index + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  const luminance = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  return (1.05 / (luminance + 0.05)) >= 4.5 ? color : "#176b5b";
}
export function safeLogoUrl(url: string | null) {
  if (!url) return null;
  try { const parsed = new URL(url); return parsed.protocol === "https:" ? parsed.toString() : null; }
  catch { return null; }
}
export function normalizeGuestPhone(phone: string) {
  const value = phone.trim().replace(/[()\s-]/g, "");
  if (!/^\+?[0-9]{6,20}$/.test(value)) throw new BookingError("INVALID_PHONE", "Enter a valid phone number");
  return value;
}

export async function resolvePublicVenue(database: BookingDatabase, rawSlug: string) {
  const slug = slugInput.safeParse(rawSlug);
  if (!slug.success) return null;
  const [org] = await database.select().from(organizations)
    .where(eq(organizations.slug, slug.data)).limit(1);
  if (!org?.onboardingCompletedAt || !org.isActive) return null;
  const [branch] = await database.select().from(branches)
    .where(and(eq(branches.organizationId, org.id), eq(branches.isActive, true)))
    .orderBy(branches.createdAt).limit(1);
  if (!branch) return null;
  const sports = await database.select({ id: sportTypes.id, code: sportTypes.code, name: sportTypes.name })
    .from(organizationSports).innerJoin(sportTypes, eq(organizationSports.sportTypeId, sportTypes.id))
    .where(and(eq(organizationSports.organizationId, org.id), eq(sportTypes.isActive, true)))
    .orderBy(sportTypes.name);
  if (!sports.length) return null;
  const hours = await database.select({ dayOfWeek: operatingHours.dayOfWeek, endMinute: operatingHours.endMinute })
    .from(operatingHours).where(and(eq(operatingHours.organizationId, org.id),
      eq(operatingHours.branchId, branch.id), isNull(operatingHours.resourceId)));
  const openWeekdays = [...new Set(hours.flatMap(hour => hour.endMinute > 1440
    ? [hour.dayOfWeek, (hour.dayOfWeek + 1) % 7] : [hour.dayOfWeek]))];
  const paymentPolicy = await getPaymentPolicy(database, org.id);
  const usage = await getBookingUsage(database, org.id);
  const checkoutAccount = paymentPolicy.requirement !== "NO_UPFRONT" ? await connectedCheckoutAccount(database, org.id) : null;
  const onlineMode = checkoutAccount?.provider === "TEST" ? "TEST" as const :
    checkoutAccount?.provider === "TOYYIBPAY_SANDBOX" ? "TOYYIBPAY_SANDBOX" as const : null;
  const paymentOptions = [
    ...(paymentPolicy.manualEnabled ? [{ value: "PAY_AT_VENUE" as const, label: "Pay at venue", description: "No payment now. Pay when you arrive." }] : []),
    ...(paymentPolicy.requirement !== "NO_UPFRONT" && onlineMode ? [{ value: "ONLINE" as const,
      label: onlineMode === "TEST" ? "Development test checkout" : "ToyyibPay sandbox",
      description: "Test payment only. No real money moves." }] : []),
  ];
  return {
    waitlistEnabled: await hasOrganizationFeature(database, org.id, "WAITLIST"),
    paymentPolicy, paymentOptions, paymentMode: paymentPolicy.requirement === "NO_UPFRONT" ? "PAY_AT_VENUE" as const :
      checkoutAccount?.provider === "TEST" ? "TEST" as const :
      checkoutAccount?.provider === "TOYYIBPAY_SANDBOX" ? "TOYYIBPAY_SANDBOX" as const : "UNAVAILABLE" as const,
    id: org.id, slug: org.slug, name: org.displayName || org.name,
    logoUrl: safeLogoUrl(org.logoUrl), color: safePublicColor(org.primaryColor),
    city: branch.city || org.city, state: branch.state || org.state,
    address: branch.addressLine1 || org.addressLine1,
    contactPhone: org.contactPhone, contactEmail: org.contactEmail,
    currency: org.currency, locale: org.locale, timezone: branch.timezone,
    branchId: branch.id, branchName: branch.name, sports, openWeekdays,
    bookingClosed: !usage.canBook,
  };
}

function assertPublicDate(date: string, now: Date, timezone: string) {
  const parsed = dateInput.parse(date);
  const chosen = Temporal.PlainDate.from(parsed);
  const today = localDateAt(now, timezone);
  if (Temporal.PlainDate.compare(chosen, today) < 0 || Temporal.PlainDate.compare(chosen, today.add({ days: 90 })) > 0)
    throw new BookingError("INVALID_DATE", "Choose a date in the next 90 days");
  return chosen;
}

export async function publicAvailability(database: BookingDatabase, slug: string, raw: {
  sportId: string; localDate: string; durationMinutes: number;
}, now = new Date()) {
  const venue = await resolvePublicVenue(database, slug);
  if (!venue) throw new BookingError("VENUE_UNAVAILABLE", "This booking page is unavailable");
  const input = z.object({
    sportId: z.uuid(), localDate: dateInput,
    durationMinutes: z.number().int().min(30).max(480),
  }).parse(raw);
  if (!venue.sports.some(sport => sport.id === input.sportId))
    throw new BookingError("SPORT_NOT_FOUND", "Choose a sport offered by this venue");
  const date = assertPublicDate(input.localDate, now, venue.timezone);
  const spaces = await database.select({
    id: resources.id, name: resources.name, sportTypeId: resources.sportTypeId,
  }).from(resources).where(and(eq(resources.organizationId, venue.id),
    eq(resources.branchId, venue.branchId), eq(resources.sportTypeId, input.sportId),
    eq(resources.status, "ACTIVE"))).orderBy(resources.name).limit(100);
  if (!spaces.length) return { venue, date: input.localDate, durationMinutes: input.durationMinutes,
    spaces: [], times: [], closed: false, priceMinor: null, dueNowMinor: null };
  const bounds = queryBounds(date, venue.timezone);
  const snapshot = await loadAvailabilitySnapshot(database, venue.id, venue.branchId,
    spaces.map(space => space.id), bounds.from, bounds.to);
  const starts = new Set<number>();
  const localDay = localDayBounds(date, venue.timezone);
  let hasOpenWindow = false;
  for (const space of snapshot.spaces) {
    for (const window of effectiveWindows(snapshot.hours, space.id, date, venue.timezone)) {
      if (window.startAt < localDay.to && window.endAt > localDay.from) hasOpenWindow = true;
      for (let start = window.startAt.getTime();
        start + input.durationMinutes * 60_000 <= window.endAt.getTime();
        start += space.bookingIntervalMinutes * 60_000) {
        if (localDateAt(new Date(start), venue.timezone).toString() === input.localDate) starts.add(start);
      }
    }
  }
  const price = await database.select({ amountMinor: basePrices.amountMinor, durationMinutes: basePrices.durationMinutes })
    .from(basePrices).where(and(eq(basePrices.organizationId, venue.id),
      eq(basePrices.branchId, venue.branchId), eq(basePrices.sportTypeId, input.sportId))).limit(1);
  const businessRules = price.length && await hasOrganizationFeature(database, venue.id, "DYNAMIC_PRICING")
    ? await database.select().from(pricingRules).where(and(eq(pricingRules.organizationId, venue.id),
      eq(pricingRules.branchId, venue.branchId), eq(pricingRules.sportTypeId, input.sportId), eq(pricingRules.isActive, true)))
    : [];
  const basePriceMinor = price.length ? Math.round(price[0].amountMinor * input.durationMinutes / price[0].durationMinutes) : null;
  const baseDueNowMinor = basePriceMinor === null ? null : paymentDue(basePriceMinor, venue.paymentPolicy).requiredNowMinor;
  const times = [...starts].sort((a, b) => a - b).slice(0, 96).map(start => {
    const startAt = new Date(start), endAt = new Date(start + input.durationMinutes * 60_000);
    return { startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      options: spaces.map(space => {
        const result = evaluateAvailability(snapshot, space.id, startAt, endAt, now);
        const rate = businessRateForStart(businessRules, space.id, startAt, venue.timezone);
        const priceMinor = basePriceMinor === null ? null : rate === null ? basePriceMinor : Math.round(rate * input.durationMinutes / 60);
        const dueNowMinor = priceMinor === null ? null : paymentDue(priceMinor, venue.paymentPolicy).requiredNowMinor;
        const tooSmallForSandbox = venue.paymentMode === "TOYYIBPAY_SANDBOX" && !venue.paymentPolicy.manualEnabled && dueNowMinor !== null && dueNowMinor < 100;
        return { resourceId: space.id, priceMinor, dueNowMinor,
          available: result.available && priceMinor !== null && venue.paymentOptions.length > 0 && !tooSmallForSandbox && !venue.bookingClosed,
          reason: venue.bookingClosed ? "VENUE_UNAVAILABLE" : result.available ? (priceMinor === null ? "PRICE_NOT_CONFIGURED" : venue.paymentOptions.length === 0 || tooSmallForSandbox ? "PAYMENT_UNAVAILABLE" : null) : result.reason };
      }),
    };
  }).filter(row => row.options.some(option => option.reason !== "ADVANCE_WINDOW"));
  return { venue, date: input.localDate, durationMinutes: input.durationMinutes,
    spaces: spaces.map(space => ({ id: space.id, name: space.name,
      label: spaceTerm(venue.sports.find(sport => sport.id === space.sportTypeId)?.code ?? "") })),
    times, closed: !hasOpenWindow, priceMinor: basePriceMinor,
    dueNowMinor: baseDueNowMinor };
}

export async function submitPublicBooking(database: BookingDatabase, slug: string, raw: unknown, now = new Date()) {
  const venue = await resolvePublicVenue(database, slug);
  if (!venue) throw new BookingError("VENUE_UNAVAILABLE", "This booking page is unavailable");
  const input = guestInput.parse(raw);
  const paymentChoice = input.paymentChoice ?? (venue.paymentPolicy.requirement === "NO_UPFRONT" ? "PAY_AT_VENUE" : "ONLINE");
  if (!venue.paymentOptions.some(option => option.value === paymentChoice))
    throw new BookingError("PAYMENT_UNAVAILABLE", "That payment choice is no longer available. Please review the venue's payment options.");
  const phone = normalizeGuestPhone(input.phone);
  const startAt = new Date(input.startAt);
  assertPublicDate(localDateAt(startAt, venue.timezone).toString(), now, venue.timezone);
  const [space] = await database.select({ id: resources.id, sportTypeId: resources.sportTypeId })
    .from(resources).where(and(eq(resources.id, input.resourceId), eq(resources.organizationId, venue.id),
      eq(resources.branchId, venue.branchId), eq(resources.status, "ACTIVE"))).limit(1);
  if (!space || !venue.sports.some(sport => sport.id === space.sportTypeId))
    throw new BookingError("RESOURCE_NOT_FOUND", "That space is unavailable");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const booking = await createGuestBooking(database, venue.id, {
    branchId: venue.branchId, resourceId: space.id, startAt,
    endAt: new Date(startAt.getTime() + input.durationMinutes * 60_000),
    source: "ONLINE",
    newCustomer: { name: input.name, phone, email: input.email.toLowerCase() },
    promoCode: input.promoCode,
  }, tokenHash, input.expectedPriceMinor, now, paymentChoice);
  const checkout = paymentChoice === "ONLINE" && venue.paymentMode === "TOYYIBPAY_SANDBOX" && booking.requiredNowMinor > 0
    ? await startToyyibSandboxCheckout(database, venue.id, booking.id, venue.slug, now) : null;
  return { token, reference: booking.bookingReference, bookingId: booking.id,
    checkoutUrl: checkout?.checkoutUrl ?? null, paymentId: checkout?.paymentId ?? null };
}

export async function publicConfirmation(database: BookingDatabase, slug: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const venue = await resolvePublicVenue(database, slug);
  if (!venue) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const [row] = await database.select({
    reference: bookings.bookingReference, startAt: bookings.startAt, endAt: bookings.endAt,
    id: bookings.id, status: bookings.status, totalAmount: bookings.totalAmount, amountPaid: bookings.amountPaid,
    paymentRequirement: bookings.paymentRequirement, requiredNowMinor: bookings.requiredNowMinor, holdExpiresAt: bookings.holdExpiresAt,
    currency: bookings.currency, customerName: customers.name, resourceName: resources.name,
    sportName: sportTypes.name, sportCode: sportTypes.code,
  }).from(bookings)
    .innerJoin(customers, and(eq(customers.id, bookings.customerId), eq(customers.organizationId, venue.id)))
    .innerJoin(resources, and(eq(resources.id, bookings.resourceId), eq(resources.organizationId, venue.id)))
    .innerJoin(sportTypes, eq(sportTypes.id, resources.sportTypeId))
    .where(and(eq(bookings.organizationId, venue.id), eq(bookings.publicAccessTokenHash, hash))).limit(1);
  if (!row) return null;
  const history = await database.select({ id: payments.id, amountMinor: payments.amountMinor, status: payments.status,
    method: payments.paymentMethod, provider: payments.provider, providerPaymentId: payments.providerPaymentId }).from(payments).where(and(
      eq(payments.organizationId, venue.id), eq(payments.bookingId, row.id))).orderBy(payments.createdAt);
  return { ...row, venue, paymentHistory: history };
}

export async function checkPublicRateLimit(database: BookingDatabase, identity: string, limit: number, windowMs: number, now = Date.now()) {
  const key = "public:" + createHash("sha256").update(identity).digest("hex");
  const cutoff = now - windowMs;
  const [state] = await database.insert(rateLimits).values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({ target: rateLimits.key, set: {
      count: sql`case when ${rateLimits.lastRequest} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
      lastRequest: now,
    } }).returning({ count: rateLimits.count });
  if (state.count > limit) throw new BookingError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
}









