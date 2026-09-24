"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { BookingError } from "@/lib/booking-availability";
import { addCustomerTag, removeCustomerTag } from "@/lib/business-segments";

function message(error: unknown) {
  if (error instanceof BookingError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the tag";
  return "Could not change the tag. Please try again.";
}
function target(data: FormData) {
  const segment = String(data.get("segment") ?? "all");
  return "/grow/segments?segment=" + encodeURIComponent(segment);
}

export async function addCustomerTagAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    await addCustomerTag(getDb(), session.user.id, organization.organizationId, {
      customerId: String(data.get("customerId") ?? ""),
      label: String(data.get("label") ?? ""),
    });
  } catch (caught) { error = message(caught); }
  if (error) redirect(target(data) + "&error=" + encodeURIComponent(error));
  revalidatePath("/grow/segments");
  redirect(target(data) + "&saved=1");
}

export async function removeCustomerTagAction(data: FormData) {
  const { session, organization } = await requireOrganizationMember();
  let error: string | null = null;
  try {
    await removeCustomerTag(getDb(), session.user.id, organization.organizationId,
      String(data.get("tagId") ?? ""));
  } catch (caught) { error = message(caught); }
  if (error) redirect(target(data) + "&error=" + encodeURIComponent(error));
  revalidatePath("/grow/segments");
  redirect(target(data) + "&saved=1");
}
