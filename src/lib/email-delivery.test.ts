import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { deliverEmail, emailConfiguration, emailReady } from "@/lib/email-delivery";
import { bookingEmailTemplate, scheduledReportEmailTemplate, subscriptionEmailTemplate } from "@/lib/email-templates";

const message = { to: "owner@example.test", subject: "Test", html: "<p>Test</p>", text: "Test", idempotencyKey: "notice-1" };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Resend email adapter", () => {
  it("keeps missing configuration truthful in development and production", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", "");
    expect(emailReady()).toBe(false);
    expect(await deliverEmail(message)).toMatchObject({ status: "DEV_PREVIEW", providerMessageId: null });
    vi.stubEnv("NODE_ENV", "production");
    expect(await deliverEmail(message)).toMatchObject({ status: "FAILED", reason: "Email provider is not configured" });
  });

  it("sends the Resend request with reply-to and idempotency without exposing the key in content", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret_value"); vi.stubEnv("EMAIL_FROM", "Slotra <hello@example.test>");
    vi.stubEnv("EMAIL_REPLY_TO", "support@example.test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }),
      { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "request_1" } }));
    expect(emailConfiguration()).toMatchObject({ ready: true, from: "Slotra <hello@example.test>", replyTo: "support@example.test" });
    expect(await deliverEmail(message)).toEqual({ status: "SENT", reason: null, providerMessageId: "email_123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_test_secret_value", "Idempotency-Key": "notice-1" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ from: "Slotra <hello@example.test>",
      to: ["owner@example.test"], reply_to: "support@example.test" });
    expect(String(init?.body)).not.toContain("re_test_secret_value");
  });

  it("returns a safe failure for rejection or network errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret_value"); vi.stubEnv("EMAIL_FROM", "hello@example.test");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("provider details", { status: 403,
      headers: { "x-request-id": "request_2" } })).mockRejectedValueOnce(new Error("secret network detail"));
    await expect(deliverEmail(message)).resolves.toMatchObject({ status: "FAILED", reason: "Email provider rejected the request" });
    await expect(deliverEmail(message)).resolves.toMatchObject({ status: "FAILED", reason: "Email provider request failed" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("re_test_secret_value"); expect(logged).not.toContain("provider details");
    expect(logged).not.toContain("secret network detail");
  });

  it("blocks preview recipients by default and sends only exact allowlisted addresses", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("STAGING_EMAIL_ALLOWLIST", "");
    vi.stubEnv("RESEND_API_KEY", "re_test_secret_value"); vi.stubEnv("EMAIL_FROM", "hello@example.test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "preview_1" })));
    expect(await deliverEmail(message)).toMatchObject({ status: "FAILED", providerMessageId: null });
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("STAGING_EMAIL_ALLOWLIST", "different@example.test,OWNER@example.test");
    expect(await deliverEmail(message)).toMatchObject({ status: "SENT", providerMessageId: "preview_1" });
    expect(send.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(send.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not accept malformed provider identifiers as delivery evidence", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret_value"); vi.stubEnv("EMAIL_FROM", "hello@example.test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: { unexpected: true } })));
    expect(await deliverEmail(message)).toMatchObject({ status: "FAILED", providerMessageId: null });
  });

  it("rejects multiline senders and invalid reply-to configuration without network traffic", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret_value"); vi.stubEnv("EMAIL_FROM", "Slotra\r\n <hello@example.test>");
    expect(emailReady()).toBe(false);
    vi.stubEnv("EMAIL_FROM", "hello@example.test"); vi.stubEnv("EMAIL_REPLY_TO", "javascript:bad");
    expect(emailReady()).toBe(false);
  });
});

describe("transactional email templates", () => {
  it("renders branded manual-payment booking copy and sanitizes dynamic text", () => {
    const template = bookingEmailTemplate({ event: "CONFIRMED",
      branding: { name: "Smash <Arena>", accent: "#176b5b", logoUrl: "javascript:alert(1)", contactPhone: "03-1234 5678" },
      customerName: "Afiq <script>alert(1)</script>", bookingReference: "BK-123", resourceName: "Court 2",
      date: "27 Sep 2026", time: "8:00 PM–9:00 PM", total: "RM60.00", paid: "RM0.00",
      outstanding: "RM60.00", paymentRequirement: "NO_UPFRONT" });
    expect(template.text).toContain("Payment due at venue: RM60.00");
    expect(template.text).not.toContain("online payment");
    expect(template.html).toContain("Afiq &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(template.html).not.toContain("javascript:");
  });

  it.each([
    ["trial.ending", "Your trial is ending soon"], ["subscription.started", "Subscription started"],
    ["payment.failed", "Subscription payment needs attention"], ["plan.upgraded", "Plan upgraded"],
    ["plan.downgraded", "Plan changed"], ["cancellation.scheduled", "Cancellation scheduled"],
  ])("renders the %s subscription notice", (type, title) => {
    const template = subscriptionEmailTemplate({ type, venueName: "Smash Arena", planName: "Professional",
      status: "ACTIVE", periodEnd: "2026-10-27", trialEnd: type === "trial.ending" ? "2026-10-10" : null });
    expect(template.text).toContain(title); expect(template.text).toContain("Venue: Smash Arena");
  });

  it("uses the current billing period rather than an old trial date after payment", () => {
    const template = subscriptionEmailTemplate({ type: "subscription.renewed", venueName: "Smash Arena",
      planName: "Professional", status: "ACTIVE", periodEnd: "2026-12-27", trialEnd: "2026-10-10" });
    expect(template.text).toContain("27 Dec 2026");
    expect(template.text).not.toContain("10 Oct 2026");
  });

  it.each(["RESCHEDULED", "CANCELLED"] as const)("renders %s without implying an online payment or refund", event => {
    const template = bookingEmailTemplate({ event, branding: { name: "Smash Arena", accent: "#ffffff" },
      customerName: "Afiq", bookingReference: "BK-123", resourceName: "Court 2", date: "27 Sep 2026",
      time: "8:00 PM–9:00 PM", total: "RM60.00", paid: "RM0.00", outstanding: "RM60.00", paymentRequirement: "NO_UPFRONT" });
    expect(template.text).not.toContain("online payment");
    expect(template.html).toContain("color:#176b5b");
    if (event === "CANCELLED") expect(template.text).not.toContain("Payment due at venue");
    else expect(template.text).toContain("Payment due at venue: RM60.00");
  });

  it("renders a mobile-friendly scheduled report without internal identifiers", () => {
    const template = scheduledReportEmailTemplate({ venueName: "Smash Arena", reportName: "Weekly overview",
      period: "2026-09-21 to 2026-09-27", timezone: "Asia/Kuala_Lumpur",
      rows: [{ label: "Bookings", value: "42" }, { label: "Collected", value: "RM1,200.00" }] });
    expect(template.html).toContain('name="viewport"'); expect(template.text).toContain("Bookings: 42");
    expect(template.html).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });
});
