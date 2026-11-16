"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { invitations } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { createInvitation, renewInvitationLink, revokeInvitation } from "@/lib/organization-service";
import { isDevelopmentRuntime } from "@/lib/deployment-environment";
import { deliverAuthLink } from "@/lib/dev-mail";
import { emailReady } from "@/lib/email-delivery";
import { consumeRateLimit } from "@/lib/rate-limit";

async function sendInvitation(email: string, token: string, venueName: string) {
  await deliverAuthLink({ to: email, kind: "invitation", venueName,
    url: new URL(`/invitations/${token}`, process.env.BETTER_AUTH_URL).toString(), createdAt: new Date() });
}

export async function inviteMemberAction(form: FormData) {
  const { session, organization } = await requirePermission("member:invite");
  const local = isDevelopmentRuntime() && process.env.NODE_ENV === "development";
  if (!local && !emailReady()) redirect("/team?error=delivery");
  if (!await consumeRateLimit(getDb(), "team-invitation", `${organization.organizationId}:${session.user.id}`, 10, 3_600_000))
    redirect("/team?error=rate");
  try {
    const { invitation, token } = await createInvitation(getDb(), session.user.id, organization.organizationId, {
      email: form.get("email"), role: form.get("role"),
    });
    if (local) redirect("/team?invite=" + encodeURIComponent(token));
    // Keep a failed invitation pending so the owner can retry delivery with a fresh link.
    try { await sendInvitation(invitation.email, token, organization.name); }
    catch { redirect("/team?error=delivery"); }
    redirect("/team?sent=1");
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
  if (!isDevelopmentRuntime() || process.env.NODE_ENV !== "development") return { error: "Use Resend invitation to send a fresh private link." };
  try {
    const token = await renewInvitationLink(getDb(), session.user.id, organization.organizationId, invitationId);
    return { token };
  } catch {
    return { error: "This invitation is no longer pending. Refresh the page and try again." };
  }
}

export async function resendInvitationAction(form: FormData) {
  const { session, organization } = await requirePermission("member:invite");
  const invitationId = String(form.get("invitationId") ?? "");
  if (!emailReady()) redirect("/team?error=delivery");
  if (!await consumeRateLimit(getDb(), "team-invitation", `${organization.organizationId}:${session.user.id}`, 10, 3_600_000))
    redirect("/team?error=rate");
  try {
    const token = await renewInvitationLink(getDb(), session.user.id, organization.organizationId, invitationId);
    const [invitation] = await getDb().select({ email: invitations.email }).from(invitations)
      .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, organization.organizationId))).limit(1);
    if (!invitation) redirect("/team?error=invalid");
    await sendInvitation(invitation.email, token, organization.name);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/team?error=delivery");
  }
  redirect("/team?sent=1");
}
