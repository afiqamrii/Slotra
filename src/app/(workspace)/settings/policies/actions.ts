"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { saveVenuePolicies } from "@/lib/venue-policies";
export async function savePoliciesAction(form: FormData) {
  const { session, organization } = await requirePermission("organization:update");
  let saved = false;
  try {
    await saveVenuePolicies(getDb(), session.user.id, organization.organizationId, {
      cancellationPolicy: form.get("cancellationPolicy"), refundPolicy: form.get("refundPolicy"), venueRules: form.get("venueRules"),
    });
    saved = true; revalidatePath(`/book/${organization.slug}`);
  } catch { /* Only safe form state is returned. */ }
  redirect(`/settings/policies?result=${saved ? "saved" : "failed"}`);
}
