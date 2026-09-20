"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireUser, setCurrentOrganization } from "@/lib/authorization";
import { acceptInvitation } from "@/lib/organization-service";
export async function acceptInvitationAction(form: FormData) {
  const { user } = await requireUser();
  const token = String(form.get("token") ?? "");
  let organizationId: string;
  try {
    organizationId = await acceptInvitation(getDb(), user.id, token);
  } catch {
    redirect("/invitations/" + encodeURIComponent(token) + "?error=invalid");
  }
  await setCurrentOrganization(organizationId);
  redirect("/dashboard");
}

