import "server-only";

import { z } from "zod";

/** Only approved transactional templates. No marketing or free-form blast API. */
export const whatsappEvents = [
  "BOOKING_CONFIRMATION", "BOOKING_REMINDER", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED",
  "PAYMENT_REMINDER", "WAITLIST_AVAILABILITY", "PACKAGE_BALANCE", "MEMBERSHIP_EXPIRY",
] as const;
export type WhatsAppEvent = (typeof whatsappEvents)[number];

const messageSchema = z.object({
  event: z.enum(whatsappEvents),
  recipient: z.string().trim().regex(/^\+?[0-9]{8,20}$/, "Enter a valid international phone number"),
  // Must be a provider-approved template name, never arbitrary customer-controlled message text.
  templateName: z.string().regex(/^[a-z][a-z0-9_]{1,80}$/),
  parameters: z.array(z.string().trim().max(160)).max(8),
  idempotencyKey: z.uuid(),
  consent: z.object({
    verified: z.literal(true),
    source: z.string().trim().min(2).max(80),
    recordedAt: z.coerce.date(),
  }),
});
export type WhatsAppMessage = z.infer<typeof messageSchema>;
export type WhatsAppResult = {
  status: "SUBMITTED" | "DEV_SIMULATED_SUCCESS" | "DEV_SIMULATED_FAILURE" | "DEV_SIMULATED_DELAYED";
  providerMessageId: string | null;
  reason: string | null;
};

/**
 * A future Meta Cloud API adapter implements this contract with approved template names,
 * a venue-owned sender, provider credentials kept outside database tables, and webhook
 * acknowledgement. SUBMITTED is not proof of delivery.
 */
export interface WhatsAppProvider {
  readonly kind: "META_CLOUD" | "DEVELOPMENT";
  sendTemplate(message: WhatsAppMessage): Promise<WhatsAppResult>;
}

export class DevelopmentWhatsAppProvider implements WhatsAppProvider {
  readonly kind = "DEVELOPMENT" as const;
  constructor(private readonly mode: "SUCCESS" | "FAILURE" | "DELAYED") {}
  async sendTemplate(raw: WhatsAppMessage): Promise<WhatsAppResult> {
    messageSchema.parse(raw);
    if (process.env.NODE_ENV === "production") throw new Error("Development WhatsApp is disabled in production");
    if (this.mode === "FAILURE") return { status: "DEV_SIMULATED_FAILURE", providerMessageId: null,
      reason: "Simulated provider failure" };
    if (this.mode === "DELAYED") return { status: "DEV_SIMULATED_DELAYED", providerMessageId: null,
      reason: "Simulated delayed delivery" };
    return { status: "DEV_SIMULATED_SUCCESS", providerMessageId: null,
      reason: "Development simulation only; no message was sent" };
  }
}

export function configuredWhatsAppProvider(): WhatsAppProvider | null {
  if (process.env.NODE_ENV === "production") return null;
  const mode = process.env.WHATSAPP_DEV_MODE;
  return mode === "SUCCESS" || mode === "FAILURE" || mode === "DELAYED"
    ? new DevelopmentWhatsAppProvider(mode) : null;
}

export function whatsappConnectionState() {
  const provider = configuredWhatsAppProvider();
  return provider ? { mode: "DEVELOPMENT" as const,
    label: "Development simulator only — no customer messages are sent." } :
    { mode: "NOT_CONFIGURED" as const,
      label: "WhatsApp is not connected. No WhatsApp messages are sent." };
}

/** Never silently accept an unverified consent claim or fall back to a fake live provider. */
export async function sendWhatsAppTemplate(raw: unknown, provider = configuredWhatsAppProvider()) {
  const message = messageSchema.parse(raw);
  if (!provider) throw new Error("WhatsApp provider is not configured");
  // No persisted consent record or verified venue sender exists yet. Do not expose a live
  // path merely because a future adapter implements the interface.
  if (provider.kind !== "DEVELOPMENT")
    throw new Error("Live WhatsApp delivery requires verified consent and provider setup");
  return provider.sendTemplate(message);
}
