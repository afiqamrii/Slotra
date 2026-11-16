import "server-only";
import { z } from "zod";
import { deploymentEnvironment, recipientAllowed } from "@/lib/deployment-environment";
import { logEvent } from "@/lib/structured-log";
export { escapeEmailHtml } from "@/lib/email-templates";

const address = z.email();
function senderValid(value: string) {
  if (/[\r\n]/.test(value)) return false;
  const match = value.match(/^\s*(?:[^<>\r\n]+\s*)?<([^<>\s]+)>\s*$/);
  return address.safeParse(match?.[1] ?? value.trim()).success;
}
export function emailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "", from = process.env.EMAIL_FROM?.trim() ?? "";
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || null;
  const ready = /^re_[A-Za-z0-9_-]{8,}$/.test(apiKey) && senderValid(from) && (!replyTo || address.safeParse(replyTo).success);
  return { ready, apiKey, from, replyTo };
}
export function emailReady() { return emailConfiguration().ready; }

function safeFailure(code: string, status?: number) {
  logEvent("email.failed", { code, provider: "resend", ...(status ? { status } : {}) }, "error");
}

export async function deliverEmail(input: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
  const configuration = emailConfiguration();
  if (!configuration.ready) return { status: deploymentEnvironment() === "development" ? "DEV_PREVIEW" as const : "FAILED" as const,
    reason: "Email provider is not configured", providerMessageId: null };
  if (!address.safeParse(input.to).success || !recipientAllowed(input.to)) {
    safeFailure("RECIPIENT_NOT_ALLOWED");
    return { status: "FAILED" as const, reason: "Email recipient is not allowed in this environment", providerMessageId: null };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${configuration.apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ from: configuration.from, to: [input.to], subject: input.subject,
        html: input.html, text: input.text, ...(configuration.replyTo ? { reply_to: configuration.replyTo } : {}) }),
      signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store",
    });
    if (!response.ok) {
      safeFailure("PROVIDER_REJECTED", response.status);
      return { status: "FAILED" as const, reason: "Email provider rejected the request", providerMessageId: null };
    }
    const data = z.object({ id: z.string().min(1).max(200) }).safeParse(await response.json());
    if (!data.success) {
      safeFailure("INVALID_PROVIDER_RESPONSE", response.status);
      return { status: "FAILED" as const, reason: "Email provider response was incomplete", providerMessageId: null };
    }
    return { status: "SENT" as const, reason: null, providerMessageId: data.data.id };
  } catch {
    safeFailure("PROVIDER_UNAVAILABLE");
    return { status: "FAILED" as const, reason: "Email provider request failed", providerMessageId: null };
  }
}
