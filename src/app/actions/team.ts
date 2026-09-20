"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { createInvitation, renewInvitationLink, revokeInvitation } from "@/lib/organization-service";

export async function inviteMemberAction(form: FormData) {
  const { session, organization } = await requirePermission("member:invite");
  if (process.env.NODE_ENV !== "development") redirect("/team?error=delivery");
  try {
    const { token } = await createInvitation(getDb(), session.user.id, organization.organizationId, {
      email: form.get("email"), role: form.get("role"),
    });
    redirect("/team?invite=" + encodeURIComponent(token));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/team?error=invalid");
  }
}

export async function revokeInvitationAction(form: FormData) {
  const { session, organization } = await requirePermission("member:invite");
  await revokeInvitation(getDb(), session.user.id, organization.organizationId, String(form.get("invitationId") ?? ""));
  redirect("/team");
}



export async function renewInvitationLinkAction(invitationId: string): Promise<{ token?: string; error?: string }> {
  const { session, organization } = await requirePermission("member:invite");
  if (process.env.NODE_ENV !== "development") return { error: "Invitation links are unavailable here." };
  try {
    const token = await renewInvitationLink(getDb(), session.user.id, organization.organizationId, invitationId);
    return { token };
  } catch {
    return { error: "This invitation is no longer pending. Refresh the page and try again." };
  }
}
