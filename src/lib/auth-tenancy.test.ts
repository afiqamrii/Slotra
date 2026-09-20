import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createAuth } from "@/lib/auth-factory";
import { acceptInvitation, authorizedMembership, createInvitation, createOrganization, invitationHash, membershipsFor, renewInvitationLink, revokeInvitation, selectOrganization } from "@/lib/organization-service";
import { hasPermission } from "@/lib/permissions";
import { revokeSession, revokeOtherSessions, revokeAllSessions } from "@/lib/session-service";

describe("authentication and tenant boundaries", () => {
  const postgres = new PGlite({ extensions: { btree_gist } });
  const database = drizzle({ client: postgres, schema });
  const messages: { to: string; kind: string; url: string }[] = [];
  const auth = createAuth(database, {
    baseURL: "http://localhost:3000", secret: "test-secret-at-least-thirty-two-characters",
    deliver: async (message) => { messages.push(message); },
  });
  const base = "http://localhost:3000/api/auth";
  const email = "owner@example.test";
  let ownerId = "";
  let organizationId = "";
  let sessionCookie = "";
  let sessionId = "";

  async function request(path: string, body?: object, cookie?: string) {
    return auth.handler(new Request(base + path, {
      method: body ? "POST" : "GET", headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      }, body: body ? JSON.stringify(body) : undefined,
    }));
  }
  async function payload(response: Response) { return response.json() as Promise<Record<string, unknown> | null>; }

  beforeAll(async () => {
    for (const name of ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]) {
      const file = name === "0000" ? "drizzle/0000_talented_smiling_tiger.sql" :
        name === "0001" ? "drizzle/0001_stormy_triathlon.sql" : name === "0002" ? "drizzle/0002_funny_iceman.sql" : name === "0003" ? "drizzle/0003_panoramic_gravity.sql" : name === "0004" ? "drizzle/0004_flashy_enchantress.sql" : name === "0005" ? "drizzle/0005_soft_wrecker.sql" : name === "0006" ? "drizzle/0006_graceful_miek.sql" : name === "0007" ? "drizzle/0007_flaky_madelyne_pryor.sql" : "drizzle/0008_worthless_expediter.sql";
      const sql = readFileSync(resolve(file), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
        await postgres.exec(statement);
      }
    }
    const planMigration = readFileSync(resolve("drizzle/0012_massive_marvel_zombies.sql"), "utf8");
    for (const statement of planMigration.split("--> statement-breakpoint").map(item => item.trim()).filter(Boolean))
      await postgres.exec(statement);
  }, 30000);
  afterAll(async () => { await postgres.close(); });

  it("registers a user with the existing users table and verifies email", async () => {
    const response = await request("/sign-up/email", { name: "Venue Owner", email, password: "a-long-passphrase-12345", callbackURL: "/login" });
    expect(response.status).toBe(200);
    const [user] = await database.select().from(schema.users).where(eq(schema.users.email, email));
    expect(user).toBeDefined();
    expect(user.emailVerified).toBe(false);
    ownerId = user.id;
    expect(messages.find((item) => item.to === email && item.kind === "verification")).toBeDefined();
    const url = messages.at(-1)!.url;
    const verified = await auth.handler(new Request(url));
    expect(verified.status).toBe(302);
    const [updated] = await database.select().from(schema.users).where(eq(schema.users.id, ownerId));
    expect(updated.emailVerified).toBe(true);
  });

  it("guards unauthenticated sessions and signs in only with verified credentials", async () => {
    const guest = await request("/get-session");
    expect(await payload(guest)).toBeNull();
    const response = await request("/sign-in/email", { email, password: "a-long-passphrase-12345" });
    expect(response.status).toBe(200);
    sessionCookie = response.headers.get("set-cookie")!.split(";")[0];
    const signedIn = await request("/get-session", undefined, sessionCookie);
    const data = await payload(signedIn);
    expect((data!.user as { id: string }).id).toBe(ownerId);
    sessionId = (data!.session as { id: string }).id;
  });

  it("creates an organization transactionally and makes its creator OWNER", async () => {
    const org = await createOrganization(database, ownerId, { name: "Rally House", slug: "rally-house" });
    organizationId = org.id;
    // These legacy invitation tests cover auth behavior, not Starter seat caps.
    await database.update(schema.organizations).set({ planCode: "PROFESSIONAL" }).where(eq(schema.organizations.id, org.id));
    expect(org.timezone).toBe("Asia/Kuala_Lumpur");
    expect(org.currency).toBe("MYR");
    expect((await membershipsFor(database, ownerId))[0].role).toBe("OWNER");
  });

  it("rejects invalid or duplicate slugs", async () => {
    await expect(createOrganization(database, ownerId, { name: "Bad", slug: "Bad Slug!" })).rejects.toThrow();
    await expect(createOrganization(database, ownerId, { name: "Duplicate", slug: "rally-house" })).rejects.toThrow();
    expect((await membershipsFor(database, ownerId))).toHaveLength(1);
  });

  it("denies unrelated organization access and switching", async () => {
    const other = await database.insert(schema.users).values({ name: "Other", email: "other@example.test", emailVerified: true }).returning();
    expect(await authorizedMembership(database, other[0].id, organizationId)).toBeNull();
    await expect(selectOrganization(database, other[0].id, organizationId)).rejects.toThrow("access denied");
  });

  it("enforces centralized member permissions for invitations", async () => {
    const [viewer] = await database.insert(schema.users).values({ name: "Viewer", email: "viewer@example.test", emailVerified: true }).returning();
    await database.insert(schema.organizationMembers).values({ userId: viewer.id, organizationId, role: "VIEWER" });
    expect(hasPermission("VIEWER", "member:invite")).toBe(false);
    await expect(createInvitation(database, viewer.id, organizationId, { email: "new@example.test", role: "OWNER" })).rejects.toThrow();
    await expect(createInvitation(database, viewer.id, organizationId, { email: "new@example.test", role: "STAFF" })).rejects.toThrow("Permission denied");
    // This temporary authorization fixture should not consume a Professional staff seat in later invitation tests.
    await database.update(schema.organizationMembers).set({ status: "SUSPENDED" })
      .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.organizationMembers.userId, viewer.id)));
  });

  it("accepts a valid invitation once and only for its verified email", async () => {
    const [invitee] = await database.insert(schema.users).values({ name: "Invitee", email: "invitee@example.test", emailVerified: true }).returning();
    const { invitation, token } = await createInvitation(database, ownerId, organizationId, { email: invitee.email, role: "STAFF" });
    expect(invitation.tokenHash).toBe(invitationHash(token));
    expect(invitation.tokenHash).not.toBe(token);
    const [wrong] = await database.insert(schema.users).values({ name: "Wrong", email: "wrong@example.test", emailVerified: true }).returning();
    await expect(acceptInvitation(database, wrong.id, token)).rejects.toThrow();
    expect(await acceptInvitation(database, invitee.id, token)).toBe(organizationId);
    expect((await authorizedMembership(database, invitee.id, organizationId))?.role).toBe("STAFF");
    await expect(acceptInvitation(database, invitee.id, token)).rejects.toThrow();
  });

  it("renews pending links only for authorized members and invalidates the old token", async () => {
    const [invitee] = await database.insert(schema.users).values({ name: "Renewed", email: "renewed@example.test", emailVerified: true }).returning();
    const [outsider] = await database.insert(schema.users).values({ name: "Outsider", email: "outsider@example.test", emailVerified: true }).returning();
    const original = await createInvitation(database, ownerId, organizationId, { email: invitee.email, role: "STAFF" });
    await expect(renewInvitationLink(database, outsider.id, organizationId, original.invitation.id)).rejects.toThrow("Permission denied");
    const freshToken = await renewInvitationLink(database, ownerId, organizationId, original.invitation.id);
    expect(freshToken).not.toBe(original.token);
    await expect(acceptInvitation(database, invitee.id, original.token)).rejects.toThrow();
    expect(await acceptInvitation(database, invitee.id, freshToken)).toBe(organizationId);
    await expect(renewInvitationLink(database, ownerId, organizationId, original.invitation.id)).rejects.toThrow("no longer pending");
  });

  it("rejects expired and revoked invitations", async () => {
    const [invitee] = await database.insert(schema.users).values({ name: "Pending", email: "pending@example.test", emailVerified: true }).returning();
    const expired = await createInvitation(database, ownerId, organizationId, { email: invitee.email, role: "MANAGER" });
    await database.update(schema.invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invitations.id, expired.invitation.id));
    await expect(acceptInvitation(database, invitee.id, expired.token)).rejects.toThrow();
    expect((await database.select().from(schema.invitations).where(eq(schema.invitations.id, expired.invitation.id)))[0].status).toBe("EXPIRED");
    const revoked = await createInvitation(database, ownerId, organizationId, { email: invitee.email, role: "MANAGER" });
    await revokeInvitation(database, ownerId, organizationId, revoked.invitation.id);
    await expect(acceptInvitation(database, invitee.id, revoked.token)).rejects.toThrow();
  });

  it("switches only among active memberships", async () => {
    const second = await createOrganization(database, ownerId, { name: "Second Venue", slug: "second-venue" });
    expect((await selectOrganization(database, ownerId, second.id)).role).toBe("OWNER");
    await database.update(schema.organizationMembers).set({ status: "SUSPENDED" }).where(and(eq(schema.organizationMembers.userId, ownerId), eq(schema.organizationMembers.organizationId, second.id)));
    await expect(selectOrganization(database, ownerId, second.id)).rejects.toThrow();
  });

  it("resets a password through Better Auth and invalidates existing sessions", async () => {
    const response = await request("/request-password-reset", { email, redirectTo: "/reset-password" });
    expect(response.status).toBe(200);
    const link = messages.findLast((item) => item.kind === "password reset" && item.to === email)?.url;
    expect(link).toBeDefined();
    const resetUrl = new URL(link!);
    const token = resetUrl.searchParams.get("token") ?? resetUrl.pathname.split("/").at(-1);
    expect(token).toBeTruthy();
    const reset = await request("/reset-password", { token, newPassword: "another-long-passphrase-54321" });
    expect(reset.status).toBe(200);
    expect(await payload(await request("/get-session", undefined, sessionCookie))).toBeNull();
    const oldPassword = await request("/sign-in/email", { email, password: "a-long-passphrase-12345" });
    expect(oldPassword.status).not.toBe(200);
    const signedIn = await request("/sign-in/email", { email, password: "another-long-passphrase-54321" });
    expect(signedIn.status).toBe(200);
    sessionCookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    sessionId = ((await payload(await request("/get-session", undefined, sessionCookie)))!.session as { id: string }).id;
  });
  it("scopes targeted and bulk session revocation to the authenticated user", async () => {
    const [other] = await database.insert(schema.users).values({ name: "Another", email: "another@example.test", emailVerified: true }).returning();
    const expiresAt = new Date(Date.now() + 86400000);
    const [foreign] = await database.insert(schema.sessions).values({ userId: other.id, token: "foreign-token", expiresAt }).returning();
    const [second] = await database.insert(schema.sessions).values({ userId: ownerId, token: "owner-second", expiresAt }).returning();
    await revokeSession(database, ownerId, sessionId, foreign.id);
    expect((await database.select().from(schema.sessions).where(eq(schema.sessions.id, foreign.id))).length).toBe(1);
    await revokeSession(database, ownerId, sessionId, second.id);
    expect((await database.select().from(schema.sessions).where(eq(schema.sessions.id, second.id))).length).toBe(0);
    await revokeSession(database, ownerId, sessionId, sessionId);
    expect((await payload(await request("/get-session", undefined, sessionCookie)))?.session).not.toBeNull();
    await database.insert(schema.sessions).values({ userId: ownerId, token: "owner-third", expiresAt });
    await revokeOtherSessions(database, ownerId, sessionId);
    expect((await database.select().from(schema.sessions).where(eq(schema.sessions.userId, ownerId))).length).toBe(1);
    await revokeAllSessions(database, ownerId);
    expect(await payload(await request("/get-session", undefined, sessionCookie))).toBeNull();
    expect((await database.select().from(schema.sessions).where(eq(schema.sessions.id, foreign.id))).length).toBe(1);
  });

  it("logs out through Better Auth", async () => {
    await database.delete(schema.rateLimits);
    const signedIn = await request("/sign-in/email", { email, password: "another-long-passphrase-54321" });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
    const loggedOut = await request("/sign-out", {}, cookie);
    expect(loggedOut.status).toBe(200);
    expect(await payload(await request("/get-session", undefined, cookie))).toBeNull();
  });
});





