import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { toyyibSandboxConfig, verifiedToyyibTransaction } from "@/lib/toyyibpay-sandbox";
import { developmentBillingEnabled } from "@/lib/subscription-provider";
import { testPaymentsEnabled } from "@/lib/payment-policy";
import { configuredWhatsAppProvider, DevelopmentWhatsAppProvider, sendWhatsAppTemplate } from "@/lib/whatsapp-provider";
import { deliverAuthLink, getDevelopmentMessages } from "@/lib/dev-mail";
import { safeWebhookUrl } from "@/lib/pro-webhooks";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const message = { event: "BOOKING_CONFIRMATION", recipient: "+60123456789", templateName: "booking_confirmation",
  parameters: ["Court 2"], idempotencyKey: "11111111-1111-4111-8111-111111111111",
  consent: { verified: true, source: "fixture", recordedAt: new Date() } } as const;

describe("hosted integration safety", () => {
  it.each([
    { DEPLOYMENT_ENV: "production", NODE_ENV: "development" },
    { DEPLOYMENT_ENV: "staging", NODE_ENV: "development" },
    { VERCEL_ENV: "preview", NODE_ENV: "development" },
    { NODE_ENV: "production" },
  ])("disables simulators and sandbox transport in hosted environments %o", async environment => {
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    vi.stubEnv("ENABLE_TEST_PAYMENTS", "true"); vi.stubEnv("ENABLE_DEV_SUBSCRIPTIONS", "true");
    vi.stubEnv("DEV_SUBSCRIPTION_WEBHOOK_SECRET", "fixture-only-secret-with-at-least-32-characters");
    vi.stubEnv("ENABLE_TOYYIBPAY_SANDBOX", "true"); vi.stubEnv("TOYYIBPAY_SANDBOX_SCOPE", "ALL_TEST_VENUES");
    vi.stubEnv("TOYYIBPAY_SANDBOX_SECRET_KEY", "fixture-secret"); vi.stubEnv("TOYYIBPAY_SANDBOX_CATEGORY_CODE", "fixture-category");
    vi.stubEnv("WHATSAPP_DEV_MODE", "SUCCESS");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network disabled in adapter safety tests"));
    expect(testPaymentsEnabled()).toBe(false); expect(developmentBillingEnabled()).toBe(false);
    expect(toyyibSandboxConfig("fixture-venue")).toBeNull(); expect(configuredWhatsAppProvider()).toBeNull();
    await expect(verifiedToyyibTransaction({ billCode: "fixture-bill", paymentId: "fixture", amountMinor: 100 }))
      .rejects.toThrow("disabled outside local development");
    await expect(sendWhatsAppTemplate(message, new DevelopmentWhatsAppProvider("SUCCESS")))
      .rejects.toThrow("disabled outside local development");
    await expect(deliverAuthLink({ to: "owner@example.test", kind: "verification", url: "https://app.example.test/private-token", createdAt: new Date() }))
      .rejects.toThrow("Email delivery is not configured");
    expect(getDevelopmentMessages()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });

  it("requires an actual consent claim even for a local WhatsApp simulation", async () => {
    await expect(sendWhatsAppTemplate({ ...message, consent: { ...message.consent, verified: false } },
      new DevelopmentWhatsAppProvider("SUCCESS"))).rejects.toThrow();
  });

  it.each(["https://[::1]/", "https://[2606:4700:4700::1111]/", "https://localhost./", "https://printer/", "http://hooks.example.com/"])
    ("rejects unsafe webhook destinations %s before storing them", url => {
      expect(() => safeWebhookUrl(url)).toThrow("public HTTPS endpoint");
    });
});
