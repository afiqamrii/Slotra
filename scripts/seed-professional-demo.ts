import { and, asc, count, eq, like, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Temporal } from "@js-temporal/polyfill";
import { getDatabaseUrl } from "../src/db/env";
import * as schema from "../src/db/schema";

const accountEmail = "professional.owner@example.test";
const fixtureReferencePrefix = "A27-%";
const timezone = "Asia/Kuala_Lumpur";
const databaseUrl = getDatabaseUrl();

if (process.env.NODE_ENV === "production" || !process.argv.includes("--apply")) {
  throw new Error("Professional demo seed requires a nonproduction environment and the explicit --apply flag.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
const db = drizzle({ client: pool, schema });
type BookingInsert = typeof schema.bookings.$inferInsert;
type BookingStatus = typeof schema.bookingStatuses[number];
type BookingSource = typeof schema.bookingSources[number];

const resourceDefinitions = [
  { name: "Badminton Court A", sport: "BADMINTON", description: "Competition-grade court with taraflex flooring", displayType: "COURT", capacity: 4, rate: 2800, duration: 60, hours: [8, 10, 12, 15, 17, 18, 19, 20, 21] },
  { name: "Badminton Court B", sport: "BADMINTON", description: "Competition-grade court with taraflex flooring", displayType: "COURT", capacity: 4, rate: 2800, duration: 60, hours: [8, 9, 11, 14, 17, 18, 19, 20, 21] },
  { name: "Badminton Court C", sport: "BADMINTON", description: "Air-conditioned court near the players' lounge", displayType: "COURT", capacity: 4, rate: 2800, duration: 60, hours: [8, 10, 13, 16, 17, 18, 19, 20, 21] },
  { name: "Badminton Court D", sport: "BADMINTON", description: "Air-conditioned court for social and coaching sessions", displayType: "COURT", capacity: 4, rate: 2800, duration: 60, hours: [9, 11, 13, 15, 17, 18, 19, 20, 21] },
  { name: "Pickleball Court 1", sport: "PICKLEBALL", description: "Dedicated indoor pickleball court", displayType: "COURT", capacity: 4, rate: 3600, duration: 60, hours: [8, 10, 12, 15, 17, 18, 19, 20] },
  { name: "Pickleball Court 2", sport: "PICKLEBALL", description: "Dedicated indoor pickleball court", displayType: "COURT", capacity: 4, rate: 3600, duration: 60, hours: [9, 11, 13, 16, 17, 18, 19, 20] },
  { name: "Futsal Arena", sport: "FUTSAL", description: "Five-a-side synthetic-turf arena", displayType: "ARENA", capacity: 14, rate: 12000, duration: 120, hours: [8, 10, 12, 14, 16, 18, 20] },
  { name: "Table Tennis Studio", sport: "TABLE_TENNIS", description: "Two tournament tables in a private studio", displayType: "ROOM", capacity: 8, rate: 1800, duration: 60, hours: [9, 11, 13, 15, 17, 18, 19, 20, 21] },
] as const;

const malayGiven = ["Aiman", "Akmal", "Amira", "Aqilah", "Danish", "Farah", "Hafiz", "Hakim", "Hana", "Haziq", "Irfan", "Izzah", "Nadia", "Nabil", "Nabila", "Najwa", "Rafiq", "Sabrina", "Syafiq", "Yasmin"];
const malayFamily = ["Azman", "Fauzi", "Hamid", "Hassan", "Ibrahim", "Ismail", "Rahman", "Razak"];
const chineseGiven = ["Alyssa", "Brandon", "Cheryl", "Daniel", "Elaine", "Ethan", "Grace", "Jia Wei", "Kai Wen", "Marcus", "Mei Ling", "Rachel", "Ryan", "Siew Li", "Wei Jian", "Xin Yi"];
const chineseFamily = ["Chan", "Cheong", "Chong", "Goh", "Lee", "Lim", "Ng", "Ong", "Tan", "Wong"];
const indianGiven = ["Aarav", "Ananya", "Arjun", "Deepa", "Kavitha", "Kiran", "Maya", "Nisha", "Priya", "Raj", "Ravi", "Sanjay", "Shalini", "Vikram"];
const indianFamily = ["Anand", "Kumar", "Menon", "Nair", "Pillai", "Raman", "Subramaniam", "Vellu"];
const customerNames = [
  ...malayGiven.flatMap(given => malayFamily.slice(0, 3).map(family => `${given} ${family}`)),
  ...chineseFamily.flatMap(family => chineseGiven.slice(0, 5).map(given => `${family} ${given}`)),
  ...indianGiven.flatMap(given => indianFamily.slice(0, 3).map(family => `${given} ${family}`)),
].slice(0, 140);

function randomFactory(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}
const random = randomFactory(27092026);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
function shuffled<T>(items: readonly T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}
function localInstant(date: Temporal.PlainDate, hour: number) {
  return new Date(Number(Temporal.ZonedDateTime.from({ timeZone: timezone, year: date.year, month: date.month,
    day: date.day, hour }).epochMilliseconds));
}
function usagePeriod(confirmedAt: Date) {
  const start = new Date(Date.UTC(confirmedAt.getUTCFullYear(), confirmedAt.getUTCMonth(), 1));
  const end = new Date(Date.UTC(confirmedAt.getUTCFullYear(), confirmedAt.getUTCMonth() + 1, 1));
  return { start, end };
}
function chunks<T>(rows: T[], size = 500) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

async function main() {
  const result = await db.transaction(async tx => {
    const [owner] = await tx.select().from(schema.users).where(eq(schema.users.email, accountEmail)).limit(1);
    if (!owner?.emailVerified) throw new Error("The Professional test owner is missing or unverified.");
    const [membership] = await tx.select({ organizationId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers).where(and(eq(schema.organizationMembers.userId, owner.id),
        eq(schema.organizationMembers.role, "OWNER"), eq(schema.organizationMembers.status, "ACTIVE"))).limit(1);
    if (!membership) throw new Error("The Professional test owner has no active owner membership.");
    const [organization] = await tx.select().from(schema.organizations)
      .where(eq(schema.organizations.id, membership.organizationId)).for("update").limit(1);
    if (!organization || organization.planCode !== "PROFESSIONAL") throw new Error("Target organization is not Professional.");
    const [slugConflict] = await tx.select({ id: schema.organizations.id }).from(schema.organizations)
      .where(and(eq(schema.organizations.slug, "arena-27-sports-hub"), ne(schema.organizations.id, organization.id))).limit(1);
    if (slugConflict) throw new Error("The Arena 27 public slug is already in use.");
    const [branch] = await tx.select().from(schema.branches)
      .where(and(eq(schema.branches.organizationId, organization.id), eq(schema.branches.isActive, true)))
      .orderBy(asc(schema.branches.createdAt)).limit(1);
    if (!branch) throw new Error("Target organization has no active branch.");

    await tx.update(schema.users).set({ name: "Amir Hakim", updatedAt: new Date() }).where(eq(schema.users.id, owner.id));
    await tx.update(schema.organizations).set({ name: "Arena 27 Sports Hub", displayName: "Arena 27 Sports Hub",
      slug: "arena-27-sports-hub", contactPhone: "+60327002700", contactEmail: "hello@arena27.example",
      addressLine1: "27 Jalan Arena", addressLine2: "Bukit Jalil", city: "Kuala Lumpur",
      state: "Wilayah Persekutuan", postcode: "57000", primaryColor: "#176B5B", updatedAt: new Date() })
      .where(eq(schema.organizations.id, organization.id));
    await tx.update(schema.branches).set({ name: "Bukit Jalil Sports Centre", addressLine1: "27 Jalan Arena",
      addressLine2: "Bukit Jalil", city: "Kuala Lumpur", state: "Wilayah Persekutuan", postcode: "57000",
      updatedAt: new Date() }).where(and(eq(schema.branches.id, branch.id), eq(schema.branches.organizationId, organization.id)));

    const sports = await tx.select().from(schema.sportTypes);
    const sportByCode = new Map(sports.map(sport => [sport.code, sport]));
    for (const code of ["BADMINTON", "PICKLEBALL", "FUTSAL", "TABLE_TENNIS"] as const) {
      const sport = sportByCode.get(code);
      if (!sport) throw new Error(`Sport catalog entry ${code} is missing.`);
      await tx.insert(schema.organizationSports).values({ organizationId: organization.id, sportTypeId: sport.id })
        .onConflictDoNothing({ target: [schema.organizationSports.organizationId, schema.organizationSports.sportTypeId] });
      const definition = resourceDefinitions.find(item => item.sport === code)!;
      await tx.insert(schema.basePrices).values({ organizationId: organization.id, branchId: branch.id,
        sportTypeId: sport.id, amountMinor: definition.rate, durationMinutes: 60 })
        .onConflictDoUpdate({ target: [schema.basePrices.organizationId, schema.basePrices.branchId, schema.basePrices.sportTypeId],
          set: { amountMinor: definition.rate, durationMinutes: 60, updatedAt: new Date() } });
    }

    const currentResources = await tx.select().from(schema.resources)
      .where(and(eq(schema.resources.organizationId, organization.id), eq(schema.resources.branchId, branch.id)))
      .orderBy(asc(schema.resources.createdAt));
    const reusable = currentResources.filter(item => item.name.startsWith("Test Court"));
    for (const [index, definition] of resourceDefinitions.entries()) {
      const sport = sportByCode.get(definition.sport)!;
      const existing = currentResources.find(item => item.name === definition.name) ?? reusable[index];
      const values = { sportTypeId: sport.id, name: definition.name, description: definition.description,
        displayType: definition.displayType, capacity: definition.capacity, status: "ACTIVE",
        minimumDurationMinutes: definition.duration, maximumDurationMinutes: definition.duration === 120 ? 120 : 180,
        bookingIntervalMinutes: definition.duration, minimumAdvanceMinutes: 60, maximumAdvanceDays: 60,
        updatedAt: new Date() } as const;
      if (existing) await tx.update(schema.resources).set(values).where(and(eq(schema.resources.id, existing.id),
        eq(schema.resources.organizationId, organization.id)));
      else await tx.insert(schema.resources).values({ organizationId: organization.id, branchId: branch.id, ...values });
    }
    const resources = await tx.select().from(schema.resources)
      .where(and(eq(schema.resources.organizationId, organization.id), eq(schema.resources.branchId, branch.id)))
      .orderBy(asc(schema.resources.name));
    const resourceByName = new Map(resources.map(resource => [resource.name, resource]));

    const [existingFixture] = await tx.select({ total: count() }).from(schema.bookings)
      .where(and(eq(schema.bookings.organizationId, organization.id), like(schema.bookings.bookingReference, fixtureReferencePrefix)));
    if ((existingFixture?.total ?? 0) > 0) return { organizationId: organization.id, alreadySeeded: true,
      bookings: existingFixture!.total, customers: 0, payments: 0, refunds: 0, blocks: 0 };

    const today = Temporal.Now.zonedDateTimeISO(timezone).toPlainDate();
    const customerRows = customerNames.map((name, index) => ({ organizationId: organization.id, name,
      email: `member${String(index + 1).padStart(3, "0")}@demo.arena27.example`,
      phone: `+6011${String(index + 1).padStart(8, "0")}`,
      notes: ["Regular weekday player", "Weekend social player", "Corporate group coordinator", "Coaching programme participant"][index % 4],
      createdAt: localInstant(today.subtract({ days: 120 - index % 80 }), 10),
      updatedAt: localInstant(today.subtract({ days: 120 - index % 80 }), 10) }));
    const insertedCustomers = await tx.insert(schema.customers).values(customerRows).returning();
    const customers = insertedCustomers.sort((left, right) => left.phone.localeCompare(right.phone));

    type Generated = { booking: BookingInsert; confirmedAt: Date; finalAt: Date; paymentAmount: number; refundAmount: number };
    const generated: Generated[] = [];
    const firstDay = today.subtract({ days: 89 });
    const now = new Date();
    for (let dayOffset = 0; dayOffset < 97; dayOffset++) {
      const day = firstDay.add({ days: dayOffset });
      const weekend = day.dayOfWeek >= 6;
      const currentMonth = day.year === today.year && day.month === today.month;
      for (const [resourceIndex, definition] of resourceDefinitions.entries()) {
        const resource = resourceByName.get(definition.name);
        if (!resource) throw new Error(`Resource ${definition.name} was not created.`);
        const activeProbability = definition.sport === "FUTSAL" ? (weekend ? 0.9 : 0.65) : (weekend ? 0.98 : 0.86);
        if (random() > activeProbability) continue;
        const bookingCount = 1 + (random() < (weekend ? 0.72 : 0.32) ? 1 : 0) + (weekend && random() < 0.22 ? 1 : 0);
        const hours = shuffled(definition.hours).slice(0, bookingCount).sort((left, right) => left - right);
        for (const [slotIndex, hour] of hours.entries()) {
          const startAt = localInstant(day, hour);
          const endAt = new Date(startAt.getTime() + definition.duration * 60_000);
          const isPast = endAt < now;
          const statusRoll = random();
          const status: BookingStatus = isPast ? statusRoll < 0.81 ? "COMPLETED" : statusRoll < 0.91 ? "CANCELLED" : statusRoll < 0.97 ? "NO_SHOW" : "CONFIRMED"
            : statusRoll < 0.91 ? "CONFIRMED" : "CANCELLED";
          const source: BookingSource = random() < 0.56 ? "ONLINE" : random() < 0.64 ? "STAFF" : "WALK_IN";
          const poolStart = currentMonth && random() > 0.72 ? 95 : 0;
          const poolSize = poolStart ? customers.length - poolStart : Math.min(100, customers.length);
          const customer = customers[poolStart + Math.floor(Math.pow(random(), 1.65) * poolSize)]!;
          const peakMultiplier = hour >= 18 ? 1.2 : 1;
          const weekendMultiplier = weekend ? 1.1 : 1;
          const subtotal = Math.round(definition.rate * (definition.duration / 60) * peakMultiplier * weekendMultiplier / 100) * 100;
          const discount = random() < 0.12 ? Math.round(subtotal * 0.1 / 100) * 100 : 0;
          const total = subtotal - discount;
          let paymentAmount = 0, refundAmount = 0, amountPaid = 0;
          if (status === "CANCELLED" && random() < 0.42) { paymentAmount = total; refundAmount = total; }
          else if (status !== "CANCELLED") {
            const paymentRoll = random();
            if (paymentRoll < 0.67) paymentAmount = amountPaid = total;
            else if (paymentRoll < 0.86) paymentAmount = amountPaid = Math.round(total * 0.5);
          }
          const leadDays = 1 + Math.floor(random() * (source === "WALK_IN" ? 2 : 20));
          const confirmedAt = new Date(startAt.getTime() - leadDays * 86_400_000);
          const finalAt = status === "CANCELLED" ? new Date(startAt.getTime() - (2 + Math.floor(random() * 48)) * 3_600_000)
            : new Date(endAt.getTime() + 5 * 60_000);
          const reference = `A27-${String(day.year).slice(2)}${String(day.month).padStart(2, "0")}${String(day.day).padStart(2, "0")}-${resourceIndex}${slotIndex}`;
          generated.push({ confirmedAt, finalAt, paymentAmount, refundAmount, booking: {
            organizationId: organization.id, branchId: branch.id, resourceId: resource.id, customerId: customer.id,
            bookingReference: reference, startAt, endAt, status, source,
            notes: source === "WALK_IN" ? "Front desk booking" : source === "STAFF" ? "Booked by venue team" : null,
            subtotal, discountAmount: discount, taxAmount: 0, totalAmount: total, amountPaid,
            paymentRequirement: paymentAmount > 0 && paymentAmount < total ? "PERCENT_DEPOSIT" : paymentAmount === total ? "FULL" : "NO_UPFRONT",
            requiredNowMinor: 0, holdExpiresAt: null, currency: "MYR",
            createdByUserId: source === "ONLINE" ? null : owner.id,
            cancelledAt: status === "CANCELLED" ? finalAt : null,
            cancellationReason: status === "CANCELLED" ? pick(["Customer changed plans", "Weather affected travel", "Duplicate booking", "Group unavailable"]) : null,
            createdAt: confirmedAt, updatedAt: finalAt,
          } });
        }
      }
    }

    const bookingRows = await tx.insert(schema.bookings).values(generated.map(item => item.booking)).returning();
    const bookingByReference = new Map(bookingRows.map(booking => [booking.bookingReference, booking]));
    const historyRows: (typeof schema.bookingStatusHistory.$inferInsert)[] = [];
    const usageRows: (typeof schema.bookingUsageRecords.$inferInsert)[] = [];
    const paymentRows: (typeof schema.payments.$inferInsert)[] = [];
    const refundByBooking = new Map<string, { amount: number; at: Date }>();
    for (const item of generated) {
      const booking = bookingByReference.get(item.booking.bookingReference);
      if (!booking) throw new Error(`Inserted booking ${item.booking.bookingReference} was not returned.`);
      historyRows.push({ organizationId: organization.id, bookingId: booking.id, newStatus: "CONFIRMED",
        changedByUserId: item.booking.source === "ONLINE" ? null : owner.id, createdAt: item.confirmedAt });
      if (item.booking.status !== "CONFIRMED") historyRows.push({ organizationId: organization.id, bookingId: booking.id,
        previousStatus: "CONFIRMED", newStatus: item.booking.status, changedByUserId: owner.id,
        reason: item.booking.cancellationReason ?? undefined, createdAt: item.finalAt });
      const period = usagePeriod(item.confirmedAt);
      usageRows.push({ organizationId: organization.id, bookingId: booking.id, periodStartAt: period.start,
        periodEndAt: period.end, confirmedAt: item.confirmedAt });
      if (item.paymentAmount > 0) {
        const refunded = item.refundAmount > 0;
        paymentRows.push({ organizationId: organization.id, bookingId: booking.id, provider: "MANUAL",
          amountMinor: item.paymentAmount, currency: "MYR", status: refunded ? "REFUNDED" : "PAID",
          paymentMethod: pick(["CASH", "BANK_TRANSFER", "CARD_TERMINAL"]),
          type: item.paymentAmount < booking.totalAmount ? "DEPOSIT" : "MANUAL_PAYMENT", paidAt: item.confirmedAt,
          recordedByUserId: owner.id, createdAt: item.confirmedAt, updatedAt: refunded ? item.finalAt : item.confirmedAt });
        if (refunded) refundByBooking.set(booking.id, { amount: item.refundAmount, at: item.finalAt });
      }
    }
    for (const batch of chunks(historyRows)) await tx.insert(schema.bookingStatusHistory).values(batch);
    for (const batch of chunks(usageRows)) await tx.insert(schema.bookingUsageRecords).values(batch);
    const insertedPayments = paymentRows.length ? await tx.insert(schema.payments).values(paymentRows).returning() : [];
    const refundRows = insertedPayments.flatMap(payment => {
      const refund = refundByBooking.get(payment.bookingId);
      return refund ? [{ organizationId: organization.id, paymentId: payment.id, bookingId: payment.bookingId,
        amountMinor: refund.amount, reason: "Cancelled booking refund", status: "SUCCEEDED" as const,
        createdByUserId: owner.id, createdAt: refund.at, updatedAt: refund.at }] : [];
    });
    if (refundRows.length) await tx.insert(schema.refunds).values(refundRows);

    const blockRows = Array.from({ length: 12 }, (_, index) => {
      const definition = resourceDefinitions[index % resourceDefinitions.length]!;
      const resource = resourceByName.get(definition.name)!;
      const day = firstDay.add({ days: index * 7 + 3 });
      return { organizationId: organization.id, branchId: branch.id, resourceId: resource.id,
        startAt: localInstant(day, 12), endAt: localInstant(day, 15),
        reason: index % 3 === 0 ? "Scheduled surface maintenance" : index % 3 === 1 ? "Private coaching clinic" : "Lighting inspection",
        type: index % 3 === 0 ? "MAINTENANCE" as const : index % 3 === 1 ? "PRIVATE_EVENT" as const : "OTHER" as const,
        createdBy: owner.id, createdAt: localInstant(day.subtract({ days: 5 }), 9), updatedAt: localInstant(day.subtract({ days: 5 }), 9) };
    });
    await tx.insert(schema.resourceBlocks).values(blockRows);
    return { organizationId: organization.id, alreadySeeded: false, bookings: bookingRows.length,
      customers: customers.length, payments: insertedPayments.length, refunds: refundRows.length, blocks: blockRows.length };
  });
  console.log(JSON.stringify(result));
}

main().finally(() => pool.end()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Professional demo seed failed.");
  process.exitCode = 1;
});
