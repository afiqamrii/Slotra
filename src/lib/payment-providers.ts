import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { testPaymentsEnabled } from "@/lib/payment-policy";

export type ProviderEvent = {
  eventId: string; paymentId: string; status: "PAID" | "FAILED" | "PROCESSING";
};
export interface PaymentProvider {
  readonly id: string;
  createPayment(input: { paymentId: string; amountMinor: number; currency: string; checkout?: { organizationId: string; venueSlug: string; bookingReference: string; customerName: string; customerEmail: string; customerPhone: string; holdExpiresAt: Date } }): Promise<{ providerPaymentId: string; checkoutUrl: string | null }>;
  getPaymentStatus(providerPaymentId: string, expected?: { paymentId: string; amountMinor: number }): Promise<"PENDING" | "PROCESSING" | "PAID" | "FAILED">;
  refundPayment(input: { paymentId: string; amountMinor: number; refundId: string }): Promise<{ providerRefundId: string; status: "SUCCEEDED" | "FAILED" }>;
  verifyWebhook(raw: string, signature: string, secret: string): ProviderEvent;
}
const eventInput = z.object({
  eventId: z.uuid(), paymentId: z.uuid(),
  status: z.enum(["PAID", "FAILED", "PROCESSING"]),
}).strict();

export const manualProvider: PaymentProvider = {
  id: "MANUAL",
  async createPayment() { throw new Error("Manual payments do not create online checkout sessions"); },
  async getPaymentStatus() { throw new Error("Manual payments are verified by authorized staff"); },
  async refundPayment(input) { return { providerRefundId: "manual:" + input.refundId, status: "SUCCEEDED" }; },
  verifyWebhook() { throw new Error("Manual payments do not accept webhooks"); },
};

export const testProvider: PaymentProvider = {
  id: "TEST",
  async createPayment(input) {
    if (!testPaymentsEnabled()) throw new Error("Test provider disabled");
    return { providerPaymentId: "test:" + input.paymentId, checkoutUrl: null };
  },
  async getPaymentStatus() {
    if (!testPaymentsEnabled()) throw new Error("Test provider disabled");
    return "PENDING";
  },
  async refundPayment(input) {
    if (!testPaymentsEnabled()) throw new Error("Test provider disabled");
    return { providerRefundId: "test:" + input.refundId, status: "SUCCEEDED" };
  },
  verifyWebhook(raw, signature, secret) {
    if (!testPaymentsEnabled() || !secret || raw.length > 4096 || !/^[a-f0-9]{64}$/.test(signature))
      throw new Error("Invalid test webhook");
    const expected = createHmac("sha256", secret).update(raw).digest();
    const actual = Buffer.from(signature, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("Invalid test webhook");
    return eventInput.parse(JSON.parse(raw));
  },
};
export function signTestEvent(raw: string, secret: string) {
  if (!testPaymentsEnabled() || !secret) throw new Error("Test provider disabled");
  return createHmac("sha256", secret).update(raw).digest("hex");
}

