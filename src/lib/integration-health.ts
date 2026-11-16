import "server-only";
import { eq } from "drizzle-orm";
import { organizationPaymentAccounts, tenantDomains } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { emailReady } from "@/lib/email-delivery";
import { inspectBrandingBucket } from "@/lib/branding-storage";
import { monitoringConfiguration } from "@/lib/monitoring";
import { backgroundJobHealth } from "@/lib/background-jobs";

export type IntegrationStatus = "CONNECTED" | "NOT_CONFIGURED" | "MISCONFIGURED" | "DEGRADED";
export type IntegrationHealth = { id: string; name: string; provider: string; scope: "PLATFORM" | "VENUE";
  status: IntegrationStatus; message: string; href?: string; action?: string };
export const integrationStatusLabels: Record<IntegrationStatus, string> = {
  CONNECTED: "Connected", NOT_CONFIGURED: "Not configured", MISCONFIGURED: "Check configuration", DEGRADED: "Needs verification",
};

export async function integrationHealth(db: BookingDatabase, actorId: string, organizationId: string): Promise<IntegrationHealth[]> {
  const member = await authorizedMembership(db, actorId, organizationId, "integration:manage");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL") throw new Error("Permission denied");
  const [accounts, domains, onlineAllowed, storage, jobs] = await Promise.all([
    db.select({ provider: organizationPaymentAccounts.provider, status: organizationPaymentAccounts.status })
      .from(organizationPaymentAccounts).where(eq(organizationPaymentAccounts.organizationId, organizationId)).limit(20),
    db.select({ status: tenantDomains.status, active: tenantDomains.isActive }).from(tenantDomains)
      .where(eq(tenantDomains.organizationId, organizationId)).limit(20),
    hasOrganizationFeature(db, organizationId, "ONLINE_PAYMENTS"), inspectBrandingBucket(), backgroundJobHealth(db),
  ]);
  const emailConfigured = Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_FROM || process.env.EMAIL_REPLY_TO);
  const monitor = monitoringConfiguration();
  return [
    { id: "email", name: "Email", provider: "Resend", scope: "PLATFORM",
      status: emailReady() ? "DEGRADED" : emailConfigured ? "MISCONFIGURED" : "NOT_CONFIGURED",
      message: emailReady() ? "Sender settings are present. Send a test and check your inbox to verify delivery." : "Email sending needs a verified sender and provider configuration.",
      href: "/settings/notifications", action: "Email delivery" },
    { id: "booking-payments", name: "Online booking payments", provider: "Venue merchant account", scope: "VENUE", status: "NOT_CONFIGURED",
      message: !onlineAllowed ? "Your plan supports manual payments and Pay at venue. Online payments start with Professional." :
        accounts.some(account => account.status === "CONNECTED") ? "A development connection exists. No live merchant provider is connected." : "No provider connected. Guests can use the manual methods enabled for your venue.",
      href: "/settings/payments", action: "Payment settings" },
    { id: "saas-billing", name: "Subscription billing", provider: "Subscription provider", scope: "PLATFORM", status: "NOT_CONFIGURED",
      message: "Production subscription checkout is not connected. Development simulation does not collect money.", href: "/settings/billing", action: "Your subscription" },
    { id: "whatsapp", name: "WhatsApp", provider: "Official provider pending", scope: "VENUE", status: "NOT_CONFIGURED",
      message: "Provider onboarding, approved templates and recorded customer opt-in are required before sending." },
    { id: "storage", name: "Venue images", provider: "Supabase Storage", scope: "PLATFORM", ...storage,
      href: "/settings/storage", action: "Venue images" },
    { id: "jobs", name: "Scheduled jobs", provider: "Vercel Cron + database tasks", scope: "PLATFORM", status: jobs.status,
      message: jobs.message },
    { id: "monitoring", name: "Error monitoring", provider: "Sentry", scope: "PLATFORM",
      status: !monitor.configured ? "NOT_CONFIGURED" : monitor.valid ? "DEGRADED" : "MISCONFIGURED",
      message: monitor.valid ? "The monitoring endpoint is configured. A platform administrator must verify an event in Sentry." : "Error collection needs platform configuration. Safe server logs remain available." },
    { id: "domains", name: "Custom booking domain", provider: "DNS + hosting provider", scope: "VENUE",
      status: domains.some(domain => domain.status !== "DISABLED") ? "DEGRADED" : "NOT_CONFIGURED",
      message: domains.some(domain => domain.status === "VERIFIED") ? "DNS ownership is verified. Host registration and HTTPS readiness still require operator verification." : "A custom domain requires ownership verification and HTTPS setup. Your standard booking page remains available.",
      href: "/settings/branding", action: "Branding & domain" },
  ];
}
