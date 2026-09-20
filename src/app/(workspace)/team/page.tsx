import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { invitations, organizationMembers, users } from "@/db/schema";
import { requireOrganizationMember } from "@/lib/authorization";
import { hasPermission } from "@/lib/permissions";
import { inviteMemberAction, revokeInvitationAction } from "@/app/actions/team";
import { CopyInvitationLink } from "@/components/copy-invitation-link";
import { RenewInvitationLink } from "@/components/renew-invitation-link";
export const metadata: Metadata = { title: "Team" };
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invite?: string; error?: string }> }) {
  const { organization, memberships } = await requireOrganizationMember();
  const canView = hasPermission(organization.role, "member:view");
  const canInvite = hasPermission(organization.role, "member:invite");
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
        {process.env.NODE_ENV === "development" ? <form action={inviteMemberAction} className="team-invite-form">
          <div className="field"><label htmlFor="invite-email">Email address</label><input id="invite-email" name="email" type="email" required placeholder="teammate@venue.com" /></div>
          <div className="field"><label htmlFor="invite-role">Role</label><select id="invite-role" name="role"><option value="STAFF">Staff</option><option value="MANAGER">Manager</option><option value="VIEWER">Viewer</option><option value="ADMIN">Admin</option></select></div>
          <button className="button button-primary" type="submit">Create invitation link</button>
        </form> : <p className="form-alert">Invitation delivery is not configured for production yet.</p>}
        {query.error && <p className="form-alert">Check the invitation details. Email delivery is available in local development only.</p>}
        {query.invite && process.env.NODE_ENV === "development" && <div className="form-success invite-link-notice"><strong>Invitation link ready</strong><div className="invite-link-actions"><Link href={"/invitations/" + encodeURIComponent(query.invite)}>Open invitation</Link><CopyInvitationLink token={query.invite} /></div><small>Share privately for testing. A localhost link only works on the computer running this app.</small></div>}
      </section>}
      <section className="foundation-card"><h2>Pending invitations <span className="count-pill">{pending.length}</span></h2>{canInvite && pending.length > 0 && process.env.NODE_ENV === "development" && <p className="small-note">Copy link creates a fresh seven-day link. Any earlier link for that invitation stops working.</p>}
        {pending.length === 0 ? <p>No pending invitations.</p> : <div className="data-list">{pending.map((item) => <div className="data-row" key={item.id}><span><strong>{item.email}</strong><small>{item.role} · expires {item.expiresAt.toLocaleDateString("en-MY")}</small></span>{canInvite && <div className="pending-invite-actions">{process.env.NODE_ENV === "development" && <RenewInvitationLink invitationId={item.id} />}<form action={revokeInvitationAction}><input type="hidden" name="invitationId" value={item.id} /><button className="text-button revoke-button" type="submit">Revoke</button></form></div>}</div>)}</div>}
      </section>
    </>}
    {memberships.length > 1 && <p className="small-note">Switch organizations above to manage a different team.</p>}
  </div>;
}



