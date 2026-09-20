"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { availableSlotsForResources, BookingError } from "@/lib/booking-availability";
import { searchBookingCustomers, staffBookingDetail, bookingSetup } from "@/lib/booking-management";
import { localWallTime } from "@/lib/booking-local-input";
import { createBooking, createResourceBlock, quoteReschedule, rescheduleBooking, transitionBooking } from "@/lib/booking-service";
import type { BookingStatus } from "@/db/schema";

function actionError(error: unknown) {
  if (error instanceof BookingError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the booking details.";
  return "Something went wrong. Please try again.";
}
function refreshBookingViews() {
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/available-now");
  revalidatePath("/dashboard");
}

export async function searchBookingCustomersAction(term: string) {
  const { session, organization } = await requireOrganizationMember();
  try {
    return { matches: await searchBookingCustomers(getDb(), session.user.id, organization.organizationId, term), error: null };
  } catch (error) { return { matches: [], error: actionError(error) }; }
}

export async function bookingSlotsAction(input: { branchId: string; resourceId: string; localDate: string; durationMinutes: number }) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const result = await availableSlotsForResources(getDb(), session.user.id, organization.organizationId, {
      branchId: input.branchId, resourceIds: [input.resourceId], localDate: input.localDate,
      durationMinutes: input.durationMinutes,
    });
    return { slots: (result[input.resourceId] ?? []).map(slot => ({ startAt: slot.startAt.toISOString(), endAt: slot.endAt.toISOString() })), error: null };
  } catch (error) { return { slots: [], error: actionError(error) }; }
}

export async function createStaffBookingAction(raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const booking = await createBooking(getDb(), session.user.id, organization.organizationId, raw);
    refreshBookingViews();
    return { id: booking.id, reference: booking.bookingReference, error: null };
  } catch (error) { return { id: null, reference: null, error: actionError(error) }; }
}

export async function quoteRescheduleAction(bookingId: string, raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const input = z.object({ resourceId: z.uuid(), date: z.iso.date(), time: z.string().regex(/^\d{2}:\d{2}$/), durationMinutes: z.number().int().positive() }).parse(raw);
    const detail = await staffBookingDetail(getDb(), session.user.id, organization.organizationId, bookingId);
    const startAt = localWallTime(input.date, input.time, detail.timezone);
    const quote = await quoteReschedule(getDb(), session.user.id, organization.organizationId, bookingId, { resourceId: input.resourceId, startAt, endAt: new Date(startAt.getTime() + input.durationMinutes * 60_000) });
    return { quote, error: null };
  } catch (error) { return { quote: null, error: actionError(error) }; }
}

export async function rescheduleStaffBookingAction(bookingId: string, raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const input = z.object({ resourceId: z.uuid(), date: z.iso.date(), time: z.string().regex(/^\d{2}:\d{2}$/), durationMinutes: z.number().int().positive() }).parse(raw);
    const detail = await staffBookingDetail(getDb(), session.user.id, organization.organizationId, bookingId);
    const startAt = localWallTime(input.date, input.time, detail.timezone);
    await rescheduleBooking(getDb(), session.user.id, organization.organizationId, bookingId, { resourceId: input.resourceId, startAt, endAt: new Date(startAt.getTime() + input.durationMinutes * 60_000) });
    refreshBookingViews();
    return { error: null };
  } catch (error) { return { error: actionError(error) }; }
}

export async function changeBookingStatusAction(bookingId: string, status: BookingStatus, reason?: string) {
  const { session, organization } = await requireOrganizationMember();
  try {
    await transitionBooking(getDb(), session.user.id, organization.organizationId, bookingId, status, reason);
    refreshBookingViews();
    return { error: null };
  } catch (error) { return { error: actionError(error) }; }
}

export async function createStaffBlockAction(raw: unknown) {
  const { session, organization } = await requireOrganizationMember();
  try {
    const input = z.object({ branchId: z.uuid(), resourceId: z.uuid(), date: z.iso.date(), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), overnight: z.boolean(), type: z.enum(["MANUAL", "MAINTENANCE", "PRIVATE_EVENT", "OTHER"]), reason: z.string().trim().max(500) }).parse(raw);
    const setup = await bookingSetup(getDb(), session.user.id, organization.organizationId, "resource:manage");
    const branch = setup.branches.find(item => item.id === input.branchId);
    if (!branch) throw new BookingError("BRANCH_NOT_FOUND", "Branch not found");
    const startAt = localWallTime(input.date, input.startTime, branch.timezone);
    const endAt = localWallTime(input.date, input.endTime, branch.timezone, input.overnight);
    await createResourceBlock(getDb(), session.user.id, organization.organizationId, { branchId: input.branchId, resourceId: input.resourceId, startAt, endAt, type: input.type, reason: input.reason });
    refreshBookingViews();
    return { error: null };
  } catch (error) { return { error: actionError(error) }; }
}
