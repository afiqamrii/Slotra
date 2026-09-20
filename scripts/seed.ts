import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Temporal } from "@js-temporal/polyfill";
import { getDatabaseUrl } from "../src/db/env";
import { basePrices, bookingStatusHistory, bookings, branches, customers, operatingHours,
  organizationSports, organizations, resources, sportTypes } from "../src/db/schema";

const databaseUrl = getDatabaseUrl();
if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_SEED !== "true" ||
  (/supabase\.(co|com)/i.test(databaseUrl) && process.env.ALLOW_REMOTE_DEV_SEED !== "true")) {
  throw new Error("Development seed requires ALLOW_DEV_SEED=true and a local DB; remote Supabase also requires ALLOW_REMOTE_DEV_SEED=true.");
}
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const db = drizzle({ client: pool });

async function main() {
  try {
    await db.transaction(async tx => {
      const [organization] = await tx.insert(organizations).values({
        name: "Smash Arena", displayName: "Smash Arena", slug: "smash-arena",
        contactPhone: "+60312345678", contactEmail: "hello@smash-arena.example",
        city: "Petaling Jaya", state: "Selangor", country: "MY",
        primaryColor: "#176b5b", timezone: "Asia/Kuala_Lumpur", currency: "MYR",
        onboardingCompletedAt: new Date(), isActive: true,
      }).onConflictDoUpdate({ target: organizations.slug, set: {
        name: "Smash Arena", displayName: "Smash Arena", city: "Petaling Jaya",
        state: "Selangor", onboardingCompletedAt: new Date(), isActive: true,
      } }).returning();
      const [branch] = await tx.insert(branches).values({
        organizationId: organization.id, name: "Main Venue", slug: "main-venue",
        city: "Petaling Jaya", state: "Selangor", timezone: "Asia/Kuala_Lumpur", isActive: true,
      }).onConflictDoUpdate({ target: [branches.organizationId, branches.slug],
        set: { name: "Main Venue", isActive: true } }).returning();
      const catalog = [
        ["BADMINTON", "Badminton"], ["PICKLEBALL", "Pickleball"], ["FUTSAL", "Futsal"],
        ["TENNIS", "Tennis"], ["PADEL", "Padel"], ["BASKETBALL", "Basketball"],
        ["SQUASH", "Squash"], ["TABLE_TENNIS", "Table tennis"], ["SWIMMING", "Swimming"],
        ["GOLF_SIMULATOR", "Golf simulator"], ["OTHER", "Other"],
      ] as const;
      for (const [code, name] of catalog) {
        await tx.insert(sportTypes).values({ code, name }).onConflictDoNothing({ target: sportTypes.code });
      }
      const selectedSports = await tx.select({ id: sportTypes.id, code: sportTypes.code })
        .from(sportTypes).where(eq(sportTypes.isActive, true));
      const sportId = (code: string) => {
        const sport = selectedSports.find(item => item.code === code);
        if (!sport) throw new Error(`Seed sport ${code} missing`);
        return sport.id;
      };
      for (const [code, amountMinor] of [["BADMINTON", 2500], ["PICKLEBALL", 3000]] as const) {
        const id = sportId(code);
        await tx.insert(organizationSports).values({ organizationId: organization.id, sportTypeId: id })
          .onConflictDoNothing({ target: [organizationSports.organizationId, organizationSports.sportTypeId] });
        await tx.insert(basePrices).values({ organizationId: organization.id, branchId: branch.id,
          sportTypeId: id, amountMinor, durationMinutes: 60 })
          .onConflictDoUpdate({ target: [basePrices.organizationId, basePrices.branchId, basePrices.sportTypeId],
            set: { amountMinor, durationMinutes: 60 } });
      }
      for (const [code, names, displayType] of [
        ["BADMINTON", ["Badminton Court 1", "Badminton Court 2", "Badminton Court 3", "Badminton Court 4"], "COURT"],
        ["PICKLEBALL", ["Pickleball Court 1", "Pickleball Court 2"], "COURT"],
      ] as const) {
        for (const name of names) await tx.insert(resources).values({
          organizationId: organization.id, branchId: branch.id,
          sportTypeId: sportId(code), name, displayType,
          minimumDurationMinutes: 60, maximumDurationMinutes: 180, bookingIntervalMinutes: 60,
        }).onConflictDoNothing({ target: [resources.organizationId, resources.branchId, resources.name] });
      }
      const existingHours = await tx.select({ id: operatingHours.id }).from(operatingHours)
        .where(and(eq(operatingHours.organizationId, organization.id), eq(operatingHours.branchId, branch.id))).limit(1);
      if (!existingHours.length) await tx.insert(operatingHours).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({
        organizationId: organization.id, branchId: branch.id, dayOfWeek, startMinute: 480, endMinute: 1440,
      })));
      for (const [name, phone, email] of [
        ["Alyssa Tan", "+60123450001", "alyssa@example.test"],
        ["Daniel Lim", "+60123450002", "daniel@example.test"],
        ["Farah Ahmad", "+60123450003", "farah@example.test"],
      ] as const) {
        const existing = await tx.select({ id: customers.id }).from(customers)
          .where(and(eq(customers.organizationId, organization.id), eq(customers.phone, phone))).limit(1);
        if (!existing.length) await tx.insert(customers).values({ organizationId: organization.id, name, phone, email });
      }
      const sampleCustomers = await tx.select().from(customers).where(eq(customers.organizationId, organization.id));
      const sampleSpaces = await tx.select().from(resources).where(eq(resources.organizationId, organization.id));
      const today = Temporal.Now.zonedDateTimeISO("Asia/Kuala_Lumpur").toPlainDate();
      const local = (day: Temporal.PlainDate, hour: number) => new Date(Number(Temporal.ZonedDateTime.from({
        timeZone: "Asia/Kuala_Lumpur", year: day.year, month: day.month, day: day.day, hour,
      }).epochMilliseconds));
      const samples = [
        { day: today, hour: 20, space: "Badminton Court 1", customer: "Alyssa Tan", status: "CONFIRMED", source: "ONLINE", amount: 2500 },
        { day: today.add({ days: 1 }), hour: 19, space: "Badminton Court 2", customer: "Daniel Lim", status: "CONFIRMED", source: "STAFF", amount: 2500 },
        { day: today.subtract({ days: 1 }), hour: 18, space: "Badminton Court 1", customer: "Farah Ahmad", status: "COMPLETED", source: "WALK_IN", amount: 2500 },
        { day: today.subtract({ days: 1 }), hour: 20, space: "Pickleball Court 1", customer: "Alyssa Tan", status: "CANCELLED", source: "ONLINE", amount: 3000 },
      ] as const;
      for (const [index, sample] of samples.entries()) {
        const space = sampleSpaces.find(item => item.name === sample.space);
        const customer = sampleCustomers.find(item => item.name === sample.customer);
        if (!space || !customer) continue;
        const [booked] = await tx.insert(bookings).values({
          organizationId: organization.id, branchId: branch.id, resourceId: space.id, customerId: customer.id,
          bookingReference: `DEMO-${sample.day.toString().replaceAll("-", "")}-${index}`,
          startAt: local(sample.day, sample.hour), endAt: local(sample.day, sample.hour + 1),
          status: sample.status, source: sample.source, subtotal: sample.amount,
          totalAmount: sample.amount, currency: "MYR",
        }).onConflictDoNothing({ target: [bookings.organizationId, bookings.bookingReference] }).returning();
        if (booked) await tx.insert(bookingStatusHistory).values({ organizationId: organization.id,
          bookingId: booked.id, newStatus: sample.status });
      }
    });
    console.log("Development seed completed: Smash Arena, 2 sports, 6 courts, prices, hours, customers, and sample bookings.");
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Development seed failed.");
  process.exitCode = 1;
});
