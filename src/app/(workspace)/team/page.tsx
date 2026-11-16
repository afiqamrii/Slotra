import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { invitations, organizationMembers, users } from "@/db/schema";
import { requireOrganizationWidePermission } from "@/lib/authorization";
import { authorizedMembership } from "@/lib/organization-service";
import { isDevelopmentRuntime } from "@/lib/deployment-environment";
import { emailReady } from "@/lib/email-delivery";
import { inviteMemberAction, resendInvitationAction, revokeInvitationAction } from "@/app/actions/team";
import { CopyInvitationLink } from "@/components/copy-invitation-link";
import { RenewInvitationLink } from "@/components/renew-invitation-link";
export const metadata: Metadata = { title: "Team" };
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invite?: string; error?: string; sent?: string }> }) {
  const { session, organization, memberships } = await requireOrganizationWidePermission("member:view");
  const canView = true;
  const canInvite = Boolean(await authorizedMembership(getDb(), session.user.id, organization.organizationId, "member:invite"));
  const local = isDevelopmentRuntime() && process.env.NODE_ENV === "development";
  const deliveryReady = emailReady();
  const query = await searchParams;
  const members = canView ? await getDb().select({ name: users.name, email: users.email, role: organizationMembers.role })
    .from(organizationMembers).innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(and(eq(organizationMembers.organizationId, organization.organizationId), eq(organizationMembers.status, "ACTIVE"))) : [];
  const pending = canView ? await getDb().select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
    .from(invitations).where(and(eq(invitations.organizationId, organization.organizationId), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date()))) : [];
  return <div className="foundation-page"><p className="eyebrow">SETTINGS / TEAM</p><h1>People at {organization.name}</h1>
    <p className="foundation-lead">Manage who has access to this organization. Your role is {organization.role.toLowerCase()}.</p>
    {!canView ? <div className="foundation-card"><p>You don’t have permission to view team members.</p></div> : <>
      <section className="foundation-card"><h2>Members <span className="count-pill">{members.length}</span></h2><div className="data-list">
        {members.map((member) => <div className="data-row" key={member.email}><span><strong>{member.name}</strong><small>{member.email}</small></span><span className="role-badge">{member.role}</span></div>)}
      </div></section>
      {canInvite && <section className="foundation-card"><h2>Invite a teammate</h2><p>Invitations last seven days and can only be accepted by the invited email.</p>
        {local || deliveryReady ? <form action={inviteMemberAction} className="team-invite-form">
          <div className="field"><label htmlFor="invite-email">Email address</label><input id="invite-email" name="email" type="email" required placeholder="teammate@venue.com" /></div>
          <div className="field"><label htmlFor="invite-role">Role</label><select id="invite-role" name="role"><option value="STAFF">Staff</option><option value="MANAGER">Manager</option><option value="VIEWER">Viewer</option><option value="ADMIN">Admin</option></select></div>
          <button className="button button-primary" type="submit">{local ? "Create invitation link" : "Send invitation"}</button>
        </form> : <p className="form-alert">Invitation delivery is not configured for production yet.</p>}
        {query.error && <p className="form-alert" role="alert">{query.error === "rate" ? "Too many invitation attempts. Please wait before trying again." : query.error === "delivery" ? "The invitation email could not be sent. Check email delivery settings, then resend the pending invitation." : "Check the invitation details and available staff seats, then try again."}</p>}
        {query.sent && <p className="form-success" role="status">Invitation accepted by the email provider. Your teammate can use the private link once it reaches their inbox.</p>}
        {query.invite && local && <div className="form-success invite-link-notice"><strong>Invitation link ready</strong><div className="invite-link-actions"><Link href={"/invitations/" + encodeURIComponent(query.invite)}>Open invitation</Link><CopyInvitationLink token={query.invite} /></div><small>Share privately for testing. A localhost link only works on the computer running this app.</small></div>}
      </section>}
      <section className="foundation-card"><h2>Pending invitations <span className="count-pill">{pending.length}</span></h2>{canInvite && pending.length > 0 && <p className="small-note">A fresh seven-day link replaces the previous invitation link.</p>}
        {pending.length === 0 ? <p>No pending invitations.</p> : <div className="data-list">{pending.map((item) => <div className="data-row" key={item.id}><span><strong>{item.email}</strong><small>{item.role} · expires {item.expiresAt.toLocaleDateString("en-MY")}</small></span>{canInvite && <div className="pending-invite-actions">{local ? <RenewInvitationLink invitationId={item.id} /> : deliveryReady && <form action={resendInvitationAction}><input type="hidden" name="invitationId" value={item.id} /><button className="text-button" type="submit">Resend invitation</button></form>}<form action={revokeInvitationAction}><input type="hidden" name="invitationId" value={item.id} /><button className="text-button revoke-button" type="submit">Revoke</button></form></div>}</div>)}</div>}
      </section>
    </>}
    {memberships.length > 1 && <p className="small-note">Switch organizations above to manage a different team.</p>}
  </div>;
}



