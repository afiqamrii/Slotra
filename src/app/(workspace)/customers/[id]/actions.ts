"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { requireOrganizationWidePermission } from "@/lib/authorization";
import { updateCustomer } from "@/lib/customer-service";
import { BookingError } from "@/lib/booking-availability";

export async function updateCustomerAction(customerId: string, raw: unknown) {
  const { organization, session } = await requireOrganizationWidePermission("customer:manage");
  try {
    const customer = await updateCustomer(getDb(), session.user.id, organization.organizationId, customerId, raw);
    revalidatePath("/customers"); revalidatePath(`/customers/${customerId}`); revalidatePath("/bookings");
    return { updatedAt: customer.updatedAt.toISOString(), error: null };
  } catch (error) {
    return { updatedAt: null, error: error instanceof BookingError ? error.message : error instanceof ZodError
      ? error.issues[0]?.message ?? "Check the customer details." : "Could not save the customer. Please try again." };
  }
}
