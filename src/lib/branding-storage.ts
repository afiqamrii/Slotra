import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@/db/schema";
import type { BookingDatabase } from "@/lib/booking-availability";
import { authorizedMembership } from "@/lib/organization-service";
import { checkPublicRateLimit } from "@/lib/public-booking";
import { deploymentEnvironment } from "@/lib/deployment-environment";
import { productUrls } from "@/lib/product-urls";
import { recordAudit } from "@/lib/pro-access-service";

export function storageConfiguration() {
  const url = process.env.SUPABASE_STORAGE_URL;
  const key = process.env.SUPABASE_STORAGE_SECRET_KEY;
  const bucket = process.env.SUPABASE_BRANDING_BUCKET;
  const configured = Boolean(url || key || bucket);
  let valid = Boolean(key && key.length >= 32 && bucket && /^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket));
  try {
    const parsed = new URL(url ?? "");
    valid &&= parsed.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(parsed.hostname) &&
      !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === "/";
    if (deploymentEnvironment() === "staging") valid &&= Boolean(process.env.STAGING_STORAGE_PROJECT_REF) &&
      parsed.hostname === `${process.env.STAGING_STORAGE_PROJECT_REF}.supabase.co`;
  } catch { valid = false; }
  return { configured, valid, url, key, bucket };
}

async function storageRequest(path: string, init: RequestInit = {}) {
  const config = storageConfiguration();
  if (!config.valid) throw new Error("Storage needs configuration.");
  return fetch(`${config.url!.replace(/\/$/, "")}/storage/v1/${path}`, { ...init, redirect: "error", cache: "no-store",
    headers: { ...init.headers, apikey: config.key!, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10_000) });
}

export async function inspectBrandingBucket() {
  const config = storageConfiguration();
  if (!config.configured) return { status: "NOT_CONFIGURED" as const, message: "Branding uploads need a storage connection." };
  if (!config.valid) return { status: "MISCONFIGURED" as const, message: "Storage configuration is incomplete or unsafe for this environment." };
  try {
    const response = await storageRequest(`bucket/${config.bucket}`);
    if (!response.ok) return { status: "DEGRADED" as const, message: "The branding bucket could not be verified." };
    const parsed = z.object({ id: z.string(), public: z.boolean() }).safeParse(await response.json());
    if (!parsed.success || parsed.data.id !== config.bucket || parsed.data.public)
      return { status: "MISCONFIGURED" as const, message: "Use a private, dedicated branding bucket." };
    return { status: "CONNECTED" as const, message: "Private branding bucket verified. Only your published logo and cover are served publicly." };
  } catch { return { status: "DEGRADED" as const, message: "Storage is temporarily unreachable." }; }
}

export async function prepareBrandingImage(file: Pick<File, "name" | "type" | "size" | "arrayBuffer">, kind: "logo" | "cover") {
  const types = { "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"] };
  const allowed = types[file.type as keyof typeof types];
  if (!allowed?.includes(file.name.split(".").pop()?.toLowerCase() ?? "") || file.size <= 0 || file.size > (kind === "logo" ? 2 : 5) * 1024 * 1024)
    throw new Error("Choose a JPG, PNG or WebP image up to 2 MB for a logo or 5 MB for a cover. SVG is not accepted.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error("Invalid image.");
  const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "warning" });
  const info = await image.metadata();
  if (!info.width || !info.height || !["jpeg", "png", "webp"].includes(info.format ?? "") || (info.pages ?? 1) !== 1 ||
    `image/${info.format}` !== file.type) throw new Error("Choose a valid, still JPG, PNG or WebP image.");
  // Decode/re-encode strips metadata and embedded non-image content; never serve original upload bytes.
  return image.rotate().resize(kind === "logo" ? 512 : 1920, kind === "logo" ? 512 : 1080,
    { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}

export async function uploadBranding(db: BookingDatabase, actorId: string, organizationId: string, kind: "logo" | "cover", file: File) {
  const member = await authorizedMembership(db, actorId, organizationId, "organization:update");
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.branchScope !== "ALL") throw new Error("Permission denied");
  await checkPublicRateLimit(db, `branding:${organizationId}:${actorId}`, 15, 3_600_000);
  if ((await inspectBrandingBucket()).status !== "CONNECTED") throw new Error("Branding storage is not ready.");
  const [venue] = await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!venue) throw new Error("Venue not found");
  const data = await prepareBrandingImage(file, kind);
  const filename = `${randomUUID()}.webp`;
  const path = `organizations/${organizationId}/branding/${filename}`;
  const response = await storageRequest(`object/${storageConfiguration().bucket}/${path}`, {
    method: "POST", headers: { "Content-Type": "image/webp", "x-upsert": "false" }, body: new Uint8Array(data) });
  if (!response.ok) throw new Error("Upload could not be completed. Please try again.");
  const url = new URL(`/api/branding/${venue.slug}/${kind}/${filename}`, productUrls.app).toString();
  await db.transaction(async tx => {
    await tx.update(organizations).set({ ...(kind === "logo" ? { logoUrl: url } : { coverImageUrl: url }), updatedAt: new Date() })
      .where(eq(organizations.id, organizationId));
    await recordAudit(tx, { organizationId, actorUserId: actorId, action: "branding.uploaded", entityType: "organization",
      entityId: organizationId, summary: `Uploaded venue ${kind}` });
  });
}

export async function fetchPublishedBranding(db: BookingDatabase, slug: string, kind: string, filename: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !["logo", "cover"].includes(kind) ||
    !/^[a-f0-9-]{36}\.webp$/.test(filename)) return null;
  const [venue] = await db.select({ id: organizations.id, active: organizations.isActive,
    logo: organizations.logoUrl, cover: organizations.coverImageUrl }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!venue?.active) return null;
  const published = kind === "logo" ? venue.logo : venue.cover;
  try { if (!published || new URL(published).pathname !== `/api/branding/${slug}/${kind}/${filename}`) return null; }
  catch { return null; }
  const response = await storageRequest(`object/authenticated/${storageConfiguration().bucket}/organizations/${venue.id}/branding/${filename}`);
  return response.ok ? response : null;
}
