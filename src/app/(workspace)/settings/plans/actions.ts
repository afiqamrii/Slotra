"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { startSandboxProfessionalUpgrade } from "@/lib/plan-upgrade-service";

export async function startProfessionalUpgradeAction(form: FormData) {
  const { organization, session, member } = await requirePermission("organization:update");
  if (member.role !== "OWNER") redirect("/settings/plans?error=owner");
  let checkoutUrl: string;
  try {
    const started = await startSandboxProfessionalUpgrade(getDb(),
      organization.organizationId, session.user.id, form.get("phone"));
    checkoutUrl = started.checkoutUrl;
  } catch {
    redirect("/settings/plans?error=checkout");
  }
  redirect(checkoutUrl);
}
