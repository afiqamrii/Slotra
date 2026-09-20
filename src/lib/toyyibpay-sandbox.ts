import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentProvider, ProviderEvent } from "@/lib/payment-providers";

const host = "https://dev.toyyibpay.com";
const billCodePattern = /^[A-Za-z0-9_-]{6,40}$/;
const callbackInput = z.object({
  order_id: z.uuid(), billcode: z.string().regex(billCodePattern),
  status: z.enum(["1", "2", "3"]), refno: z.string().max(120),
  hash: z.string().regex(/^[a-fA-F0-9]{32}$/),
});

export function toyyibSandboxConfig(organizationId: string) {
  const shared = process.env.TOYYIBPAY_SANDBOX_SCOPE === "ALL_TEST_VENUES";
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_TOYYIBPAY_SANDBOX !== "true" ||
    (!shared && process.env.TOYYIBPAY_SANDBOX_ORGANIZATION_ID !== organizationId)) return null;
  const secret = process.env.TOYYIBPAY_SANDBOX_SECRET_KEY?.trim();
  const categoryCode = process.env.TOYYIBPAY_SANDBOX_CATEGORY_CODE?.trim();
  if (!secret || !categoryCode || !/^[A-Za-z0-9_-]{4,40}$/.test(categoryCode)) return null;
  return { secret, categoryCode };
}
export function sandboxCheckoutUrl(billCode: string) {
  if (!billCodePattern.test(billCode)) throw new Error("Invalid sandbox bill code");
  return `${host}/${billCode}`;
}
function publicOrigin() {
  const parsed = new URL(process.env.BETTER_AUTH_URL ?? "");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new Error("Invalid public application origin");
  return parsed.origin;
}
function expiryAtMalaysia(date: Date) {
  const fields = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => fields.find(field => field.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
function billAmountMinor(value: unknown) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [ringgit, cents = ""] = value.split(".");
  const amount = Number(ringgit) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}
async function post(path: string, body: URLSearchParams): Promise<unknown> {
  const response = await fetch(`${host}/index.php/api/${path}`, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error("ToyyibPay sandbox unavailable");
  const raw = await response.text();
  if (raw.length > 100_000) throw new Error("Invalid ToyyibPay sandbox response");
  try { return JSON.parse(raw); } catch { throw new Error("Invalid ToyyibPay sandbox response"); }
}
export async function verifyToyyibSandboxCategory(organizationId: string) {
  const config = toyyibSandboxConfig(organizationId);
  if (!config) throw new Error("ToyyibPay sandbox is not configured for this venue");
  const result = await post("getCategoryDetails", new URLSearchParams({
    userSecretKey: config.secret, categoryCode: config.categoryCode,
  }));
  const item = Array.isArray(result) ? result[0] : result;
  const parsed = z.object({ categoryStatus: z.string() }).safeParse(item);
  if (!parsed.success || parsed.data.categoryStatus !== "1")
    throw new Error("ToyyibPay sandbox category is unavailable");
  return config.categoryCode;
}
export type ToyyibBillInput = { paymentId: string; amountMinor: number; currency: string;
  bookingReference: string; customerName: string; customerEmail: string; customerPhone: string;
  organizationId: string; venueSlug: string; holdExpiresAt: Date };
export async function createToyyibSandboxBill(input: ToyyibBillInput) {
  const config = toyyibSandboxConfig(input.organizationId);
  if (!config || input.currency !== "MYR" || input.amountMinor < 100 || !Number.isSafeInteger(input.amountMinor))
    throw new Error("ToyyibPay sandbox checkout unavailable");
  const origin = publicOrigin();
  const body = new URLSearchParams({
    userSecretKey: config.secret, categoryCode: config.categoryCode,
    billName: `Booking ${input.bookingReference}`.replace(/[^A-Za-z0-9 _]/g, " ").slice(0, 30).trim(),
    billDescription: `Venue booking ${input.bookingReference}`.replace(/[^A-Za-z0-9 _]/g, " ").slice(0, 100).trim(),
    billPriceSetting: "1", billPayorInfo: "1", billAmount: String(input.amountMinor),
    billReturnUrl: `${origin}/book/${encodeURIComponent(input.venueSlug)}/payment-return?paymentId=${input.paymentId}`,
    billCallbackUrl: `${origin}/api/payment-webhooks/toyyibpay-sandbox`,
    billExternalReferenceNo: input.paymentId,
    billTo: input.customerName, billEmail: input.customerEmail,
    billPhone: input.customerPhone.replace(/[^0-9]/g, "").replace(/^60(?=\d{9,10}$)/, "0"),
    billPaymentChannel: "0", billExpiryDate: expiryAtMalaysia(input.holdExpiresAt),
  });
  const result = await post("createBill", body);
  const parsed = z.array(z.object({ BillCode: z.string().regex(billCodePattern) })).min(1).safeParse(result);
  if (!parsed.success) throw new Error("ToyyibPay sandbox could not create a bill");
  const billCode = parsed.data[0].BillCode;
  return { providerPaymentId: billCode, checkoutUrl: sandboxCheckoutUrl(billCode) };
}
export type VerifiedToyyibTransaction = { status: "PAID" | "FAILED" | "PROCESSING";
  eventId: string; providerReference: string | null };
export async function verifiedToyyibTransaction(input: { billCode: string; paymentId: string; amountMinor: number }) {
  if (!billCodePattern.test(input.billCode)) throw new Error("Invalid ToyyibPay bill code");
  const result = await post("getBillTransactions", new URLSearchParams({ billCode: input.billCode }));
  const rows = z.array(z.object({
    billpaymentStatus: z.string(), billpaymentAmount: z.string().optional(),
    billExternalReferenceNo: z.string().optional(), billpaymentInvoiceNo: z.string().optional(),
  }).passthrough()).safeParse(result);
  if (!rows.success) throw new Error("Could not verify ToyyibPay transaction");
  const matched = rows.data.filter(row => row.billExternalReferenceNo === input.paymentId &&
    billAmountMinor(row.billpaymentAmount) === input.amountMinor);
  const picked = matched.find(row => row.billpaymentStatus === "1") ??
    matched.find(row => ["2", "4"].includes(row.billpaymentStatus)) ??
    matched.find(row => row.billpaymentStatus === "3");
  if (!picked) return null;
  const status = picked.billpaymentStatus === "1" ? "PAID" : picked.billpaymentStatus === "3" ? "FAILED" : "PROCESSING";
  const reference = picked.billpaymentInvoiceNo?.slice(0, 120) || null;
  return { status, eventId: `${input.billCode}:${picked.billpaymentStatus}:${reference ?? input.paymentId}`,
    providerReference: reference } satisfies VerifiedToyyibTransaction;
}
function parsedToyyibCallback(raw: string, secret: string) {
  if (!secret || raw.length > 4096) throw new Error("Invalid ToyyibPay callback");
  const parsed = callbackInput.safeParse(Object.fromEntries(new URLSearchParams(raw)));
  if (!parsed.success) throw new Error("Invalid ToyyibPay callback");
  const value = parsed.data;
  // ToyyibPay documents MD5 for callbacks; the handler also checks the transaction through its API.
  const expected = createHash("md5").update(secret + value.status + value.order_id + value.refno + "ok").digest();
  const actual = Buffer.from(value.hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Invalid ToyyibPay callback");
  return value;
}
export function verifyToyyibCallback(raw: string, organizationId: string) {
  const config = toyyibSandboxConfig(organizationId);
  if (!config) throw new Error("Invalid ToyyibPay callback");
  return parsedToyyibCallback(raw, config.secret);
}
export const toyyibSandboxProvider: PaymentProvider = {
  id: "TOYYIBPAY_SANDBOX",
  async createPayment(input) {
    if (!input.checkout) throw new Error("Missing hosted checkout details");
    return createToyyibSandboxBill({ paymentId: input.paymentId, amountMinor: input.amountMinor,
      currency: input.currency, ...input.checkout });
  },
  async getPaymentStatus(providerPaymentId, expected) {
    if (!expected) throw new Error("Expected payment details are required");
    const verified = await verifiedToyyibTransaction({ billCode: providerPaymentId, ...expected });
    return verified?.status ?? "PENDING";
  },
  async refundPayment() { throw new Error("ToyyibPay sandbox refunds are not supported by this integration"); },
  verifyWebhook(raw, _signature, secret) {
    const value = parsedToyyibCallback(raw, secret);
    return { paymentId: value.order_id,
      eventId: createHash("sha256").update(raw).digest("hex"),
      status: value.status === "1" ? "PAID" : value.status === "3" ? "FAILED" : "PROCESSING" } satisfies ProviderEvent;
  },
};