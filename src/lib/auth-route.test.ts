import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ ready: false, issue: null as string | null,
  auth: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: fixture.get, POST: fixture.post }) }));
vi.mock("@/lib/auth", () => ({ getAuth: fixture.auth, getAuthConfigurationIssue: () => fixture.issue,
  postgresErrorCode: (error: { code?: string }) => error?.code ?? null }));
vi.mock("@/lib/email-delivery", () => ({ emailReady: () => fixture.ready }));
import { GET, POST } from "@/app/api/auth/[...all]/route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEPLOYMENT_ENV", "production");
  vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
  fixture.ready = false; fixture.issue = null;
  fixture.auth.mockReset().mockResolvedValue({});
  fixture.get.mockReset().mockImplementation(async () => Response.json({ delegated: true }));
  fixture.post.mockReset().mockImplementation(async () => Response.json({ delegated: true }));
});
afterEach(() => vi.unstubAllEnvs());

describe("authentication route delivery preflight", () => {
  it.each(["sign-up/email", "forget-password", "request-password-reset", "send-verification-email"].flatMap(path => [path, path + "/"]))
    ("blocks %s before account/token creation when production email is missing", async path => {
      const response = await POST(new Request(`https://app.example.test/api/auth/${path}`, { method: "POST" }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ message: "Email delivery is not configured." });
      expect(fixture.auth).not.toHaveBeenCalled(); expect(fixture.post).not.toHaveBeenCalled();
    });

  it("keeps sign-in and existing-session access available without outgoing email", async () => {
    expect((await POST(new Request("https://app.example.test/api/auth/sign-in/email", { method: "POST" }))).status).toBe(200);
    expect((await GET(new Request("https://app.example.test/api/auth/get-session"))).status).toBe(200);
    expect(fixture.post).toHaveBeenCalledOnce(); expect(fixture.get).toHaveBeenCalledOnce();
  });

  it("delegates email-producing endpoints when the provider is configured", async () => {
    fixture.ready = true;
    expect((await POST(new Request("https://app.example.test/api/auth/sign-up/email", { method: "POST" }))).status).toBe(200);
    expect(fixture.post).toHaveBeenCalledOnce();
  });

  it("allows a local development inbox but never treats a hosted preview as local", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEPLOYMENT_ENV", "development");
    expect((await POST(new Request("http://localhost:3018/api/auth/request-password-reset", { method: "POST" }))).status).toBe(200);
    fixture.post.mockClear(); fixture.auth.mockClear(); vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(new Request("https://preview.example.test/api/auth/request-password-reset", { method: "POST" }))).status).toBe(503);
    expect(fixture.post).not.toHaveBeenCalled(); expect(fixture.auth).not.toHaveBeenCalled();
  });

  it.each([GET, POST])("does not expose production configuration details", async handler => {
    fixture.issue = "Private database configuration detail";
    const response = await handler(new Request("https://app.example.test/api/auth/get-session"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "Account access is temporarily unavailable." });
    expect(fixture.auth).not.toHaveBeenCalled();
  });
});
