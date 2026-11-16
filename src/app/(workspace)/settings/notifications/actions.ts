"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOrganizationMember } from "@/lib/authorization";
import { sendAuthorizedTestEmail } from "@/lib/email-test-service";

export async function sendTestEmailAction() {
  const { session, organization } = await requireOrganizationMember();
  let destination = "/settings/notifications?sent=1";
  try { await sendAuthorizedTestEmail(getDb(), session.user.id, organization.organizationId); }
  catch { destination = "/settings/notifications?error=delivery"; }
  redirect(destination);
}
