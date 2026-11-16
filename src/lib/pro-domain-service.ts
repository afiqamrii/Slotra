import { createHash, randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { organizations, tenantDomains } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { requireOrganizationFeature } from "@/lib/organization-entitlements";
import { recordAudit } from "@/lib/pro-access-service";
import { consumeRateLimit } from "@/lib/rate-limit";
import { normalizeProductDomain } from "@/lib/product-urls";

const hostnameInput = z.string().trim().toLowerCase().max(253);
const brandingInput = z.object({ displayName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoUrl: z.union([z.url({ protocol: /^https$/ }), z.literal("")]),
  coverImageUrl: z.union([z.url({ protocol: /^https$/ }), z.literal("")]),
  hidePoweredBy: z.boolean(),
});

export function normalizeCustomHostname(raw: string) {
  const hostname = hostnameInput.parse(raw).replace(/\.$/, "");
  const labels = hostname.split(".");
  const platformDomain = normalizeProductDomain(process.env.NEXT_PUBLIC_PRODUCT_DOMAIN);
  if (labels.length < 2 || isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    (platformDomain && (hostname === platformDomain || hostname.endsWith(`.${platformDomain}`))) ||
    !labels.every(label => label.length >= 1 && label.length <= 63 && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
    throw new Error("Enter a public hostname you own, such as booking.example.com");
  return hostname;
}

async function manageDomains(db: BookingDatabase, actorId: string, organizationId: string) {
  await requireOrganizationFeature(db, organizationId, "CUSTOM_DOMAIN");
  const member = await authorizedMembership(db, actorId, organizationId, "organization:update");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL")
    throw new Error("Permission denied");
}

export async function createTenantDomain(db: BookingDatabase, actorId: string, organizationId: string, raw: string) {
  await manageDomains(db, actorId, organizationId);
  const hostname = normalizeCustomHostname(raw);
  const token = randomBytes(32).toString("base64url");
  return db.transaction(async tx => {
    const [domain] = await tx.insert(tenantDomains).values({ organizationId, hostname,
      verificationTokenHash: createHash("sha256").update(token).digest("hex") }).returning();
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "domain.created", entityType: "domain",
      entityId: domain.id, summary: `Added ${hostname}` });
    return { domain, dnsName: `_slotra-verify.${hostname}`, dnsValue: `slotra-verification=${token}` };
  });
}

export async function verifyTenantDomain(db: BookingDatabase, actorId: string, organizationId: string,
  domainId: string, lookup: typeof resolveTxt = resolveTxt) {
  await manageDomains(db, actorId, organizationId);
  if (!await consumeRateLimit(db, "domain-verification", `${organizationId}:${actorId}`, 10, 60 * 60_000))
    throw new Error("Too many verification attempts. Please wait before trying again.");
  if (!z.uuid().safeParse(domainId).success) throw new Error("Domain not found");
  const [domain] = await db.select().from(tenantDomains).where(and(eq(tenantDomains.organizationId, organizationId),
    eq(tenantDomains.id, domainId))).limit(1);
  if (!domain || domain.status === "DISABLED") throw new Error("Domain not found");
  let records: string[][] = [];
  try { records = await lookup(`_slotra-verify.${domain.hostname}`); }
  catch { /* Missing DNS is a pending verification, never evidence of ownership. */ }
  const valid = records.some(parts => {
    const value = parts.join("");
    if (!value.startsWith("slotra-verification=")) return false;
    return createHash("sha256").update(value.slice("slotra-verification=".length)).digest("hex") === domain.verificationTokenHash;
  });
  if (!valid) return { verified: false, status: domain.status };
  await db.transaction(async tx => {
    await tx.update(tenantDomains).set({ status: "VERIFIED", verifiedAt: new Date(),
      // DNS verification alone does not establish that the deployment accepts the hostname.
      isActive: false, updatedAt: new Date() }).where(and(eq(tenantDomains.organizationId, organizationId),
        eq(tenantDomains.id, domain.id)));
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "domain.verified", entityType: "domain",
      entityId: domain.id, summary: `Verified DNS ownership of ${domain.hostname}` });
  });
  return { verified: true, status: "VERIFIED" as const };
}

export async function updateProBranding(db: BookingDatabase, actorId: string, organizationId: string, raw: unknown) {
  await requireOrganizationFeature(db, organizationId, "WHITE_LABEL");
  const member = await authorizedMembership(db, actorId, organizationId, "organization:update");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL")
    throw new Error("Permission denied");
  const input = brandingInput.parse(raw);
  await db.transaction(async tx => {
    const [updated] = await tx.update(organizations).set({ displayName: input.displayName,
      publicDescription: input.description || null, primaryColor: input.color,
      logoUrl: input.logoUrl || null, coverImageUrl: input.coverImageUrl || null,
      hidePoweredBy: input.hidePoweredBy, updatedAt: new Date() })
      .where(eq(organizations.id, organizationId)).returning({ id: organizations.id });
    if (!updated) throw new Error("Venue not found");
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "branding.updated", entityType: "organization",
      entityId: organizationId, summary: "Updated public booking page branding" });
  });
}
