"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/authorization";
import { getDb } from "@/db/client";
import { uploadBranding } from "@/lib/branding-storage";
export async function uploadBrandingAction(form: FormData) {
  const { session, organization } = await requirePermission("organization:update");
  let success = false;
  try {
    const file = form.get("image"), kind = form.get("kind");
    if (!(file instanceof File) || (kind !== "logo" && kind !== "cover")) throw new Error("Invalid upload");
    await uploadBranding(getDb(), session.user.id, organization.organizationId, kind, file);
    success = true; revalidatePath(`/book/${organization.slug}`);
  } catch { /* Never return storage URLs, credentials, or raw provider errors. */ }
  redirect(`/settings/storage?result=${success ? "saved" : "failed"}`);
}
