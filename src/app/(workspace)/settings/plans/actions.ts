"use server";
import { redirect } from "next/navigation";
import { requireOrganizationMember } from "@/lib/authorization";

// Historical return/callback reconciliation remains separate; new changes use subscriptions.
export async function startProfessionalUpgradeAction() {
  await requireOrganizationMember();
  redirect("/settings/plans");
}
