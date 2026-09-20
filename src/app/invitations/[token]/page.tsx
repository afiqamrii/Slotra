import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { invitations, organizations } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { invitationHash } from "@/lib/organization-service";
import { acceptInvitationAction } from "@/app/actions/invitation";
export const metadata: Metadata = { title: "Team invitation" };
export default async function InvitationPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return <main className="setup-page"><div className="setup-card"><h1>Invalid invitation</h1></div></main>;
  const [row] = await getDb().select({ email: invitations.email, role: invitations.role, status: invitations.status, expiresAt: invitations.expiresAt, name: organizations.name })
    .from(invitations).innerJoin(organizations, eq(invitations.organizationId, organizations.id))
    .where(eq(invitations.tokenHash, invitationHash(token))).limit(1);
  const valid = row?.status === "PENDING" && row.expiresAt > new Date();
  if (!valid) return <main className="setup-page"><div className="setup-card"><h1>Invitation unavailable</h1><p>This link has expired or was already used. Ask the organization to invite you again.</p></div></main>;
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const next = "/invitations/" + token;
  if (!session) return <main className="setup-page"><div className="setup-card"><p className="eyebrow">TEAM INVITATION</p><h1>Join {row.name}</h1><p>Sign in as <strong>{row.email}</strong>, or create an account with that address, to accept your {row.role.toLowerCase()} invitation.</p><div className="setup-actions"><Link className="button button-primary" href={"/login?next=" + encodeURIComponent(next)}>Sign in</Link><Link className="button button-secondary" href={"/register?next=" + encodeURIComponent(next)}>Create account</Link></div></div></main>;
  if (session.user.email.toLowerCase() !== row.email.toLowerCase()) return <main className="setup-page"><div className="setup-card"><h1>Wrong account</h1><p>This invitation is for {row.email}. Sign in with that email to accept it.</p><Link href="/account/security">Manage account</Link></div></main>;
  if (!session.user.emailVerified) redirect("/login");
  return <main className="setup-page"><div className="setup-card"><p className="eyebrow">TEAM INVITATION</p><h1>Join {row.name}</h1><p>You’ll join as {row.role.toLowerCase()} with {row.email}.</p>
    {(await searchParams).error && <p className="form-alert">This invitation can no longer be accepted.</p>}
    <form action={acceptInvitationAction}><input type="hidden" name="token" value={token} /><button className="button button-primary" type="submit">Accept invitation</button></form>
  </div></main>;
}

