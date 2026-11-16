"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requirePlatformAdministrator } from "@/lib/platform-authorization";
import { superAdminChange } from "@/lib/super-admin-service";
import { z } from "zod";
export async function adminOrganizationAction(form: FormData) {
  const session = await requirePlatformAdministrator(), id = z.uuid().parse(form.get("organizationId"));
  let result = "saved";
  try {
    await superAdminChange(getDb(), session.user.id, id, { action: form.get("action"), confirmation: form.get("confirmation"), reason: form.get("reason"),
      ...(form.get("expiresAt") ? { expiresAt: form.get("expiresAt") } : {}),
      ...(form.get("kind") ? { kind: form.get("kind"), key: form.get("key"), value: form.get("value") } : {}),
      ...(form.get("overrideId") ? { overrideId: form.get("overrideId") } : {}) });
  } catch { result = "error"; }
  revalidatePath("/", "layout");
  redirect("/admin/organizations/" + id + "?" + result + "=1");
}
