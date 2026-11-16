import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  ready: true, permitted: true, rateAllowed: true,
  select: vi.fn(), where: vi.fn(), create: vi.fn(), renew: vi.fn(), revoke: vi.fn(),
  rate: vi.fn(), deliver: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => {
  throw Object.assign(new Error("redirect:" + path), { digest: "NEXT_REDIRECT" });
} }));
vi.mock("@/db/client", () => ({ getDb: () => ({ select: fixture.select }) }));
vi.mock("@/lib/authorization", () => ({
  requirePermission: async () => {
    if (!fixture.permitted) throw new Error("not-authorized");
    return { session: { user: { id: "actor-id" } }, organization: { organizationId: "tenant-id", name: "Arena", role: "OWNER" } };
  },
  requireOrganizationWidePermission: async () => {
    if (!fixture.permitted) throw new Error("not-authorized");
    return { session: { user: { id: "actor-id" } }, organization: { organizationId: "tenant-id", name: "Arena", role: "OWNER" }, memberships: [] };
  },
}));
vi.mock("@/lib/organization-service", () => ({ createInvitation: fixture.create,
  renewInvitationLink: fixture.renew, revokeInvitation: fixture.revoke, authorizedMembership: async () => ({ role: "OWNER" }) }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: fixture.rate }));
vi.mock("@/lib/email-delivery", () => ({ emailReady: () => fixture.ready, deliverEmail: fixture.deliver }));

import { inviteMemberAction, renewInvitationLinkAction, resendInvitationAction, revokeInvitationAction } from "@/app/actions/team";
import TeamPage from "@/app/(workspace)/team/page";

const token = "a".repeat(43);
const invitationId = "d5d4af70-4317-4caf-a805-3144ea0cdf44";
function form() {
  const data = new FormData();
  data.set("email", "request@example.test"); data.set("role", "STAFF"); data.set("invitationId", invitationId);
  data.set("organizationId", "another-tenant"); data.set("actorId", "another-actor");
  return data;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEPLOYMENT_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", "https://app.example.test"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
  fixture.ready = true; fixture.permitted = true; fixture.rateAllowed = true;
  for (const mock of [fixture.select, fixture.where, fixture.create, fixture.renew, fixture.revoke, fixture.rate, fixture.deliver]) mock.mockReset();
  fixture.create.mockResolvedValue({ invitation: { email: "stored@example.test" }, token });
  fixture.renew.mockResolvedValue(token);
  fixture.rate.mockImplementation(async () => fixture.rateAllowed);
  fixture.deliver.mockResolvedValue({ status: "SENT", providerMessageId: "provider-id", reason: null });
  const query = { from: vi.fn().mockReturnThis(), where: fixture.where.mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ email: "stored@example.test" }]) };
  fixture.select.mockReturnValue(query);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("team invitation action boundaries", () => {
  it("sends production invitations using the server tenant and stored email without exposing their token", async () => {
    await expect(inviteMemberAction(form())).rejects.toThrow("redirect:/team?sent=1");
    expect(fixture.create).toHaveBeenCalledWith(expect.anything(), "actor-id", "tenant-id",
      { email: "request@example.test", role: "STAFF" });
    expect(fixture.rate).toHaveBeenCalledWith(expect.anything(), "team-invitation", "tenant-id:actor-id", 10, 3_600_000);
    expect(fixture.deliver).toHaveBeenCalledWith(expect.objectContaining({ to: "stored@example.test",
      text: expect.stringContaining(`https://app.example.test/invitations/${token}`),
      idempotencyKey: expect.stringMatching(/^account-[a-f0-9]{64}$/) }));
    expect(await renewInvitationLinkAction(invitationId)).toEqual({ error: "Use Resend invitation to send a fresh private link." });
    expect(fixture.renew).not.toHaveBeenCalled();
  });

  it.each([inviteMemberAction, resendInvitationAction])("requires authorization before attempting delivery", async action => {
    fixture.permitted = false;
    await expect(action(form())).rejects.toThrow("not-authorized");
    expect(fixture.create).not.toHaveBeenCalled(); expect(fixture.renew).not.toHaveBeenCalled();
    expect(fixture.rate).not.toHaveBeenCalled(); expect(fixture.deliver).not.toHaveBeenCalled();
  });

  it.each([inviteMemberAction, resendInvitationAction])("rejects missing configuration and exhausted rate limits before mutation", async action => {
    fixture.ready = false;
    await expect(action(form())).rejects.toThrow("redirect:/team?error=delivery");
    fixture.ready = true; fixture.rateAllowed = false;
    await expect(action(form())).rejects.toThrow("redirect:/team?error=rate");
    expect(fixture.create).not.toHaveBeenCalled(); expect(fixture.renew).not.toHaveBeenCalled();
    expect(fixture.deliver).not.toHaveBeenCalled();
  });

  it.each([inviteMemberAction, resendInvitationAction])("reports provider failure without a success response or raw token", async action => {
    fixture.deliver.mockResolvedValue({ status: "FAILED", providerMessageId: null, reason: "rejected" });
    await expect(action(form())).rejects.toThrow("redirect:/team?error=delivery");
  });

  it("resends only the server tenant's stored recipient", async () => {
    await expect(resendInvitationAction(form())).rejects.toThrow("redirect:/team?sent=1");
    expect(fixture.renew).toHaveBeenCalledWith(expect.anything(), "actor-id", "tenant-id", invitationId);
    const where = new PgDialect().sqlToQuery(fixture.where.mock.calls[0][0]);
    expect(where.sql).toContain('"invitations"."organization_id"');
    expect(where.params).toEqual([invitationId, "tenant-id"]);
    expect(fixture.deliver.mock.calls[0][0].to).toBe("stored@example.test");
  });

  it("does not deliver when the domain service rejects a foreign invitation", async () => {
    fixture.renew.mockRejectedValue(new Error("Invitation is no longer pending"));
    await expect(resendInvitationAction(form())).rejects.toThrow("redirect:/team?error=delivery");
    expect(fixture.select).not.toHaveBeenCalled(); expect(fixture.deliver).not.toHaveBeenCalled();
  });

  it("never exposes development links in a hosted preview", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL_ENV", "preview");
    expect(await renewInvitationLinkAction(invitationId)).toHaveProperty("error");
    await expect(inviteMemberAction(form())).rejects.toThrow("redirect:/team?sent=1");
    expect(fixture.deliver).toHaveBeenCalledOnce();
  });

  it("keeps link-only behavior restricted to the local development runtime", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEPLOYMENT_ENV", "development");
    fixture.ready = false;
    await expect(inviteMemberAction(form())).rejects.toThrow(`redirect:/team?invite=${token}`);
    expect(await renewInvitationLinkAction(invitationId)).toEqual({ token });
    expect(fixture.deliver).not.toHaveBeenCalled();
  });

  it("scopes revocation to the authenticated actor and organization", async () => {
    await expect(revokeInvitationAction(form())).rejects.toThrow("redirect:/team");
    expect(fixture.revoke).toHaveBeenCalledWith(expect.anything(), "actor-id", "tenant-id", invitationId);
  });

  it("does not render a supplied raw invitation token on the production team page", async () => {
    fixture.select.mockReturnValue({ from: () => ({ innerJoin: () => ({ where: async () => [] }), where: async () => [] }) });
    const markup = renderToStaticMarkup(await TeamPage({ searchParams: Promise.resolve({ invite: token }) }));
    expect(markup).not.toContain(token);
    expect(markup).not.toContain("/invitations/");
  });
});
