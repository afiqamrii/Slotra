import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { deliverAccountEmail, validateAccountLink, type AccountMessage } from "@/lib/account-email";
import { deliverAuthLink, getDevelopmentMessages } from "@/lib/dev-mail";

const base = "https://app.example.test";
function message(kind: AccountMessage["kind"] = "verification"): AccountMessage {
  const path = kind === "verification" ? "/api/auth/verify-email?token=" + "a".repeat(60) + "&callbackURL=%2Flogin"
    : kind === "password reset" ? "/api/auth/reset-password/" + "b".repeat(32) + "?callbackURL=%2Freset-password"
      : "/invitations/" + "c".repeat(43);
  return { to: "owner@example.test", kind, url: base + path, createdAt: new Date(), venueName: "<Arena>" };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function production() {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", base);
  vi.stubEnv("RESEND_API_KEY", "re_test_secret_value"); vi.stubEnv("EMAIL_FROM", "hello@example.test");
}

describe("credential-bearing account email boundary", () => {
  it.each(["verification", "password reset", "invitation"] as const)("delivers a validated %s with a stable private idempotency key", async kind => {
    production();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "email_1" })));
    await deliverAuthLink(message(kind));
    await deliverAccountEmail(message(kind));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.headers).toMatchObject({ "Idempotency-Key": expect.stringMatching(/^account-[a-f0-9]{64}$/) });
    expect(init.headers).toEqual(fetchMock.mock.calls[1][1]!.headers);
    expect(String(init.body)).toContain(base);
    expect(String(init.body)).not.toContain("re_test_secret_value");
    if (kind === "invitation") expect(String(init.body)).toContain("&lt;Arena&gt;");
    expect(getDevelopmentMessages()).toEqual([]);
  });

  it("rejects foreign origins, wrong paths, credentials, fragments and external callbacks before sending", async () => {
    production();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const valid = message();
    for (const url of [valid.url.replace(base, "https://evil.example"), base + "/other?token=" + "a".repeat(60),
      valid.url.replace("https://", "https://user:secret@"), valid.url + "#private",
      valid.url.replace("%2Flogin", "https%3A%2F%2Fevil.example%2F"), valid.url.replace("%2Flogin", "%2F%2Fevil.example")]) {
      await expect(deliverAccountEmail({ ...valid, url })).rejects.toThrow("invalid");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails truthfully when production delivery is absent or rejected", async () => {
    production(); vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(deliverAuthLink(message())).rejects.toThrow("Email delivery is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("RESEND_API_KEY", "re_test_secret_value");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response("rejected", { status: 403 }));
    await expect(deliverAuthLink(message())).rejects.toThrow("could not be sent");
  });

  it("keeps local links in the development inbox without external mail", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3018");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const local = { ...message(), url: message().url.replace(base, "http://localhost:3018") };
    await deliverAuthLink(local);
    expect(getDevelopmentMessages()[0]).toMatchObject({ url: local.url });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks hosted preview local inbox and non-allowlisted email", async () => {
    production(); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("STAGING_EMAIL_ALLOWLIST", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deliverAuthLink(message())).rejects.toThrow("could not be sent");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDevelopmentMessages()).toEqual([]);
  });

  it("rejects non-HTTPS production origins and mismatched message kinds", () => {
    production(); vi.stubEnv("BETTER_AUTH_URL", "http://app.example.test");
    expect(() => validateAccountLink({ ...message(), url: message().url.replace("https:", "http:") })).toThrow("invalid");
    vi.stubEnv("BETTER_AUTH_URL", base);
    expect(() => validateAccountLink({ ...message(), kind: "password reset" })).toThrow("invalid");
  });
});
