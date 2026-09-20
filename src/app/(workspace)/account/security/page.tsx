import type { Metadata } from "next";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions } from "@/db/schema";
import { requireUser } from "@/lib/authorization";
import { revokeSessionAction, revokeOtherSessionsAction, logoutAllSessionsAction } from "@/app/actions/security";
export const metadata: Metadata = { title: "Account security" };
export default async function SecurityPage() {
  const { user, session } = await requireUser();
  const active = await getDb().select({ id: sessions.id, userAgent: sessions.userAgent, ipAddress: sessions.ipAddress, updatedAt: sessions.updatedAt, expiresAt: sessions.expiresAt })
    .from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.updatedAt));
  return <div className="foundation-page"><p className="eyebrow">ACCOUNT / SECURITY</p><h1>Active sessions</h1>
    <p className="foundation-lead">Signed in as {user.email}. Review devices and end access you don’t recognize.</p>
    <section className="foundation-card"><h2>Devices <span className="count-pill">{active.length}</span></h2><div className="data-list">
      {active.map((item) => <div className="data-row" key={item.id}><span><strong>{item.id === session.id ? "This device" : "Other session"}</strong><small>{item.userAgent || "Unknown device"} · Last active {item.updatedAt.toLocaleString("en-MY")}</small></span>
        {item.id !== session.id && <form action={revokeSessionAction}><input type="hidden" name="sessionId" value={item.id} /><button className="text-button" type="submit">Revoke</button></form>}
      </div>)}</div>
      <div className="security-actions"><form action={revokeOtherSessionsAction}><button className="button button-secondary" type="submit">Log out other sessions</button></form>
        <form action={logoutAllSessionsAction}><button className="button button-secondary" type="submit">Log out all sessions</button></form></div>
    </section>
  </div>;
}

