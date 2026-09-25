import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { branches, customRoles, memberBranches, organizationMembers, users } from "@/db/schema";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { ProMemberControls, ProRoleCreator } from "@/components/pro-settings-forms";

export const dynamic = "force-dynamic";
export default async function AccessPage() {
  const { organization, member } = await requirePermission("member:update");
  if (!["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL") notFound();
  const db = getDb(), organizationId = organization.organizationId;
  const enabled = await hasOrganizationFeature(db, organizationId, "ADVANCED_PERMISSIONS");
  if (!enabled) return <div className="foundation-page"><Link href="/settings">← Settings</Link><h1>Team access</h1>
    <p>Custom roles and branch assignments are available on Pro.</p><Link className="button button-primary" href="/settings/plans">Compare plans</Link></div>;
  const [roles, members, locations, assignments] = await Promise.all([
    db.select({ id: customRoles.id, name: customRoles.name, baseRole: customRoles.baseRole,
      permissions: customRoles.permissions }).from(customRoles).where(and(eq(customRoles.organizationId, organizationId),
      eq(customRoles.isActive, true))).orderBy(customRoles.name),
    db.select({ id: organizationMembers.id, userId: organizationMembers.userId,
      name: users.name, email: users.email, role: organizationMembers.role,
      customRoleId: organizationMembers.customRoleId, branchScope: organizationMembers.branchScope })
      .from(organizationMembers).innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "ACTIVE")))
      .orderBy(users.name),
    db.select({ id: branches.id, name: branches.name }).from(branches)
      .where(and(eq(branches.organizationId, organizationId), eq(branches.isActive, true))).orderBy(branches.name),
    db.select({ memberId: memberBranches.memberId, branchId: memberBranches.branchId }).from(memberBranches)
      .where(eq(memberBranches.organizationId, organizationId)),
  ]);
  return <div className="foundation-page pro-settings-page"><Link className="text-link" href="/settings">← Settings</Link>
    <p className="eyebrow">PRO / TEAM ACCESS</p><h1>Roles & branch access</h1>
    <p className="foundation-lead">Give each teammate the actions and locations they need. Owners always keep full access.</p>
    <section className="foundation-card"><h2>Create a custom role</h2><ProRoleCreator /></section>
    <section className="foundation-card"><h2>Team members</h2><div className="pro-member-list">
      {members.map(person => <article key={person.id} className="pro-member-card"><div><h3>{person.name}</h3>
        <p>{person.email} · {roles.find(role => role.id === person.customRoleId)?.name ?? person.role}</p></div>
        {person.role === "OWNER" ? <span className="role-badge">Owner · all branches</span> :
          <ProMemberControls memberId={person.id} roleId={person.customRoleId} scope={person.branchScope}
            assigned={assignments.filter(item => item.memberId === person.id).map(item => item.branchId)}
            roles={roles} branches={locations} />}</article>)}</div></section>
  </div>;
}
