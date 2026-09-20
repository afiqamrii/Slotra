import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getAuth, isAuthConfigured } from "@/lib/auth";
import { authorizedMembership, membershipsFor } from "@/lib/organization-service";
import type { Permission } from "@/lib/permissions";

const organizationCookie = "slotra_org";

export async function requireUser() {
  if (!isAuthConfigured()) redirect("/login");
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

export async function requireOrganizationMember() {
  const session = await requireUser();
  const memberships = await membershipsFor(getDb(), session.user.id);
  if (memberships.length === 0) redirect("/setup");
  const selected = (await cookies()).get(organizationCookie)?.value;
  const organization = memberships.find((item) => item.organizationId === selected) ?? memberships[0];
  return { session, organization, memberships };
}

export async function requirePermission(permission: Permission) {
  const context = await requireOrganizationMember();
  const member = await authorizedMembership(getDb(), context.session.user.id, context.organization.organizationId, permission);
  if (!member) notFound();
  return { ...context, member };
}

export async function setCurrentOrganization(organizationId: string) {
  (await cookies()).set(organizationCookie, organizationId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

