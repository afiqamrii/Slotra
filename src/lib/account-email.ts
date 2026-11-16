import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { isDevelopmentRuntime } from "@/lib/deployment-environment";
import { deliverEmail, emailReady } from "@/lib/email-delivery";
import { accountEmailTemplate } from "@/lib/email-templates";

export type AccountMessage = {
  to: string;
  kind: "verification" | "password reset" | "invitation";
  url: string;
  createdAt: Date;
  venueName?: string;
};

// Credential-bearing links must always return to this application's configured origin.
// Neither request Host headers nor a client-supplied origin establish that trust.
export function validateAccountLink(message: AccountMessage) {
  const base = new URL(process.env.BETTER_AUTH_URL ?? "");
  const url = new URL(message.url);
  const local = isDevelopmentRuntime() && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((!local && base.protocol !== "https:") || base.username || base.password ||
    url.origin !== base.origin || url.username || url.password || url.hash || !z.email().safeParse(message.to).success) {
    throw new Error("Account email link is invalid.");
  }
  const validPath = message.kind === "verification"
    ? url.pathname === "/api/auth/verify-email" && /^[A-Za-z0-9_.-]{20,4096}$/.test(url.searchParams.get("token") ?? "")
    : message.kind === "password reset"
      ? /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{20,256}$/.test(url.pathname)
      : /^\/invitations\/[A-Za-z0-9_-]{43}$/.test(url.pathname) && !url.search;
  const callback = url.searchParams.get("callbackURL");
  if (!validPath || (callback && new URL(callback, base.origin).origin !== base.origin)) {
    throw new Error("Account email link is invalid.");
  }
  return url.toString();
}

export async function deliverAccountEmail(message: AccountMessage) {
  if (!emailReady()) throw new Error("Email delivery is not configured.");
  const url = validateAccountLink(message);
  const template = accountEmailTemplate({ kind: message.kind, url, venueName: message.venueName });
  // Stable for a retry of the same link without retaining or logging its raw token.
  const digest = createHash("sha256").update(`${message.kind}\0${message.to.toLowerCase()}\0${url}`).digest("hex");
  const result = await deliverEmail({ to: message.to, ...template, idempotencyKey: `account-${digest}` });
  if (result.status !== "SENT") throw new Error("Account email could not be sent. Please try again later.");
}
