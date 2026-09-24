"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { branches } from "@/db/schema";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { BookingError } from "@/lib/booking-availability";
import { localWallTime } from "@/lib/booking-local-input";
import { createPricingRule } from "@/lib/business-pricing";
import { createRecurringBookings, rescheduleFutureInSeries } from "@/lib/business-recurring";
import { updateBusinessPolicy } from "@/lib/business-rules";
import { assignCustomerMembership, createMembershipPlan, createPackagePlan,
  createPromotion, issueCustomerPackage } from "@/lib/business-benefits";

function message(error: unknown) {
  if (error instanceof BookingError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the details";
  return "Could not save. Check the details and try again.";
}
function value(data: FormData, key: string) { return String(data.get(key) ?? "").trim(); }
function minor(raw: string) {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) throw new BookingError("INVALID_PRICE", "Enter an amount such as 25 or 25.50");
  return Math.round(Number(raw) * 100);
}
function localMinute(raw: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new BookingError("INVALID_TIME", "Choose a valid time");
  return Number(raw.slice(0, 2)) * 60 + Number(raw.slice(3));
}
async function branchTimezone(organizationId: string, branchId: string) {
  const [branch] = await getDb().select({ timezone: branches.timezone }).from(branches)
    .where(and(eq(branches.organizationId, organizationId), eq(branches.id, branchId))).limit(1);
  if (!branch) throw new BookingError("BRANCH_NOT_FOUND", "Choose a venue branch");
  return branch.timezone;
}
function endOfDate(localDate: string, timezone: string) {
  return localWallTime(Temporal.PlainDate.from(localDate).add({ days: 1 }).toString(), "00:00", timezone);
}

export async function createPricingRuleAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    await createPricingRule(getDb(), session.user.id, organization.organizationId, {
      branchId: value(data, "branchId"), sportTypeId: value(data, "sportTypeId"),
      resourceId: value(data, "resourceId") || null, name: value(data, "name"),
      weekdays: data.getAll("weekday").map(Number),
      startMinute: localMinute(value(data, "startTime")),
      endMinute: value(data, "endTime") === "00:00" ? 1440 : localMinute(value(data, "endTime")),
      amountMinor: minor(value(data, "amount")),
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/pricing?error=" + encodeURIComponent(error));
  revalidatePath("/grow/pricing");
  redirect("/grow/pricing?saved=1");
}

export async function createMembershipAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    await createMembershipPlan(getDb(), session.user.id, organization.organizationId, {
      name: value(data, "name"), description: value(data, "description") || null,
      priceMinor: minor(value(data, "price")), billingPeriod: value(data, "billingPeriod") || "MONTHLY",
      discountType: value(data, "discountType") || "NONE",
      discountValue: value(data, "discountType") === "FIXED" ? minor(value(data, "discountValue")) :
        Number(value(data, "discountValue") || 0),
      advanceDays: value(data, "advanceDays") ? Number(value(data, "advanceDays")) : null,
      monthlyCreditsMinutes: Number(value(data, "creditsHours") || 0) * 60,
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/memberships?error=" + encodeURIComponent(error));
  revalidatePath("/grow/memberships");
  redirect("/grow/memberships?saved=1");
}

export async function assignMembershipAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    const timezone = await branchTimezone(organization.organizationId, value(data, "branchId"));
    await assignCustomerMembership(getDb(), session.user.id, organization.organizationId, {
      customerId: value(data, "customerId"), planId: value(data, "planId"),
      startsAt: localWallTime(value(data, "startDate"), "00:00", timezone),
      endsAt: endOfDate(value(data, "endDate"), timezone),
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/memberships?error=" + encodeURIComponent(error));
  revalidatePath("/grow/memberships");
  redirect("/grow/memberships?assigned=1");
}

export async function createPackageAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    await createPackagePlan(getDb(), session.user.id, organization.organizationId, {
      name: value(data, "name"), description: value(data, "description") || null,
      priceMinor: minor(value(data, "price")), creditsMinutes: Number(value(data, "hours")) * 60,
      validDays: value(data, "validDays") ? Number(value(data, "validDays")) : null,
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/packages?error=" + encodeURIComponent(error));
  revalidatePath("/grow/packages");
  redirect("/grow/packages?saved=1");
}

export async function issuePackageAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    await issueCustomerPackage(getDb(), session.user.id, organization.organizationId, {
      customerId: value(data, "customerId"), planId: value(data, "planId"),
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/packages?error=" + encodeURIComponent(error));
  revalidatePath("/grow/packages");
  redirect("/grow/packages?issued=1");
}

export async function createPromotionAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    const timezone = await branchTimezone(organization.organizationId, value(data, "branchId"));
    const discountType = value(data, "discountType");
    await createPromotion(getDb(), session.user.id, organization.organizationId, {
      name: value(data, "name"), code: value(data, "code"),
      discountType, discountValue: discountType === "FIXED" ? minor(value(data, "discountValue")) :
        Number(value(data, "discountValue")),
      startsAt: localWallTime(value(data, "startDate"), "00:00", timezone),
      endsAt: endOfDate(value(data, "endDate"), timezone),
      minimumSpendMinor: minor(value(data, "minimumSpend") || "0"),
      maximumDiscountMinor: value(data, "maximumDiscount") ? minor(value(data, "maximumDiscount")) : null,
      usageLimit: value(data, "usageLimit") ? Number(value(data, "usageLimit")) : null,
      perCustomerLimit: value(data, "perCustomerLimit") ? Number(value(data, "perCustomerLimit")) : null,
      newCustomerOnly: data.get("newCustomerOnly") === "on",
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/promotions?error=" + encodeURIComponent(error));
  revalidatePath("/grow/promotions");
  redirect("/grow/promotions?saved=1");
}

export async function createRecurringAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  let result: Awaited<ReturnType<typeof createRecurringBookings>> | null = null;
  try {
    const startDate = value(data, "startDate");
    const weekday = Temporal.PlainDate.from(startDate).dayOfWeek % 7;
    result = await createRecurringBookings(getDb(), session.user.id, organization.organizationId, {
      branchId: value(data, "branchId"), resourceId: value(data, "resourceId"),
      customerId: value(data, "customerId") || null,
      startDate, endDate: value(data, "endDate"), weekday,
      localTime: value(data, "localTime"), durationMinutes: Number(value(data, "durationMinutes")),
    }, data.get("skipConflicts") === "on");
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/recurring?error=" + encodeURIComponent(error));
  revalidatePath("/grow/recurring");
  revalidatePath("/bookings");
  redirect("/grow/recurring?created=" + (result?.created.length ?? 0) + "&conflicts=" + (result?.conflicts.length ?? 0));
}

export async function updateBusinessPolicyAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  const optional = (key: string) => value(data, key) === "" ? null : Number(value(data, key));
  try {
    await updateBusinessPolicy(getDb(), session.user.id, organization.organizationId, {
      minimumNoticeMinutes: optional("minimumNoticeMinutes"),
      maximumAdvanceDays: optional("maximumAdvanceDays"),
      maximumDurationMinutes: optional("maximumDurationMinutes"),
      bookingBufferMinutes: Number(value(data, "bookingBufferMinutes") || 0),
      cancellationCutoffMinutes: optional("cancellationCutoffMinutes"),
      rescheduleCutoffMinutes: optional("rescheduleCutoffMinutes"),
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/booking-rules?error=" + encodeURIComponent(error));
  revalidatePath("/grow/booking-rules");
  revalidatePath("/bookings/new");
  redirect("/grow/booking-rules?saved=1");
}

export async function rescheduleFutureAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  const seriesId = value(data, "seriesId");
  let error: string | null = null;
  let result: Awaited<ReturnType<typeof rescheduleFutureInSeries>> | null = null;
  try {
    result = await rescheduleFutureInSeries(getDb(), session.user.id, organization.organizationId,
      seriesId, value(data, "fromBookingId"), {
        resourceId: value(data, "resourceId"), localTime: value(data, "localTime"),
        durationMinutes: Number(value(data, "durationMinutes")),
      });
  } catch (caught) { error = message(caught); }
  if (error) redirect("/grow/recurring/" + seriesId + "?error=" + encodeURIComponent(error));
  revalidatePath("/grow/recurring/" + seriesId);
  revalidatePath("/bookings");
  redirect("/grow/recurring/" + seriesId + "?updated=" + (result?.changed.length ?? 0) +
    "&conflicts=" + (result?.conflicts.length ?? 0));
}
