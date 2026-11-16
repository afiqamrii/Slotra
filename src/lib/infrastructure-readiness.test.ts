import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import sharp from "sharp";
import { classifyHost, configuredHosts, publicHostPath } from "@/lib/host-routing";
import { databaseFingerprint, runtimeConfigurationIssues } from "@/lib/runtime-config";
import { prepareBrandingImage, storageConfiguration } from "@/lib/branding-storage";
import { monitoringConfiguration } from "@/lib/monitoring";
import { recipientAllowed } from "@/lib/deployment-environment";
import { safeLogRecord } from "@/lib/structured-log";
import { normalizeProductDomain, resolveProductUrls } from "@/lib/product-urls";

const production = {
  NODE_ENV: "production", DEPLOYMENT_ENV: "production",
  DATABASE_URL: "postgresql://postgres.projectref:strong-password@aws.pooler.supabase.com:6543/postgres",
  BETTER_AUTH_SECRET: "a-unique-auth-secret-at-least-32-characters",
  NEXT_PUBLIC_PRODUCT_DOMAIN: "slotra.my", BETTER_AUTH_URL: "https://app.slotra.my/",
  NEXT_PUBLIC_APP_URL: "https://app.slotra.my/", NEXT_PUBLIC_BOOKING_URL: "https://book.slotra.my/",
  NEXT_PUBLIC_MARKETING_URL: "https://slotra.my/",
} as const;

afterEach(() => vi.unstubAllEnvs());

describe("deployment readiness boundaries", () => {
  it("accepts explicit isolated production config and rejects a staging production-database match", () => {
    const fingerprint = databaseFingerprint(production.DATABASE_URL);
    expect(runtimeConfigurationIssues({ ...production, EXPECTED_DATABASE_FINGERPRINT: fingerprint })).toEqual([]);
    expect(runtimeConfigurationIssues({ ...production, DEPLOYMENT_ENV: "staging",
      EXPECTED_DATABASE_FINGERPRINT: fingerprint, PRODUCTION_DATABASE_FINGERPRINT: fingerprint }))
      .toContain("Staging must not use the production database.");
  });

  it("canonicalizes direct and pooler URLs for the same Supabase project", () => {
    const direct = "postgresql://postgres:password@db.abc123.supabase.co:5432/postgres";
    const pooler = "postgresql://postgres.abc123:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";
    expect(databaseFingerprint(direct)).toBe(databaseFingerprint(pooler));
  });

  it("classifies configured hosts and maps only public booking paths", () => {
    const env = { ...production, EXPECTED_DATABASE_FINGERPRINT: databaseFingerprint(production.DATABASE_URL) };
    expect(configuredHosts(env)).toEqual(new Set(["app.slotra.my", "book.slotra.my", "slotra.my"]));
    expect(classifyHost("book.slotra.my", env)).toBe("booking");
    expect(classifyHost("evil.slotra.my", env)).toBe("unknown");
    expect(classifyHost("evil.example", env)).toBe("unknown");
    expect(publicHostPath("/smash-arena")).toBe("/book/smash-arena");
    expect(publicHostPath("/smash-arena/payment-return")).toBe("/book/smash-arena/payment-return");
    expect(publicHostPath("/admin")).toBeNull();
    expect(publicHostPath("/", "smash-arena")).toBe("/book/smash-arena");
    expect(publicHostPath("/payment-return", "smash-arena")).toBe("/book/smash-arena/payment-return");
  });

  it("derives production origins from one normalized root domain", () => {
    expect(normalizeProductDomain("Slotra.MY.")).toBe("slotra.my");
    expect(normalizeProductDomain("https://slotra.my")).toBeNull();
    expect(resolveProductUrls({ NEXT_PUBLIC_PRODUCT_DOMAIN: "slotra.my" })).toEqual({
      marketing: "https://slotra.my", app: "https://app.slotra.my", booking: "https://book.slotra.my",
    });
    const fingerprint = databaseFingerprint(production.DATABASE_URL);
    expect(runtimeConfigurationIssues({ ...production, NEXT_PUBLIC_APP_URL: "https://wrong.slotra.my",
      EXPECTED_DATABASE_FINGERPRINT: fingerprint })).toContain("NEXT_PUBLIC_APP_URL conflicts with NEXT_PUBLIC_PRODUCT_DOMAIN.");
  });

  it("allows staging email only for an exact recipient allowlist match", () => {
    const env = { NODE_ENV: "production", DEPLOYMENT_ENV: "staging", STAGING_EMAIL_ALLOWLIST: "owner@example.test" };
    expect(recipientAllowed("OWNER@example.test", env)).toBe(true);
    expect(recipientAllowed("customer@example.test", env)).toBe(false);
  });

  it("does not leak arbitrary data through structured log context", () => {
    const record = safeLogRecord("email.failed", { code: "PROVIDER_REJECTED", route: "bad route with email@x.test" });
    expect(record).toMatchObject({ event: "email.failed", code: "PROVIDER_REJECTED", route: undefined });
  });
});

describe("optional provider validation", () => {
  it("recognizes hosted Sentry regional DSNs and rejects arbitrary collectors", () => {
    vi.stubEnv("SENTRY_DSN", "https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/456");
    expect(monitoringConfiguration()).toEqual({ configured: true, valid: true });
    vi.stubEnv("SENTRY_DSN", "https://0123456789abcdef0123456789abcdef@evil.example/456");
    expect(monitoringConfiguration()).toEqual({ configured: true, valid: false });
  });

  it("distinguishes absent storage from invalid configuration", () => {
    expect(storageConfiguration()).toMatchObject({ configured: false, valid: false });
    vi.stubEnv("SUPABASE_STORAGE_URL", "https://not-supabase.example");
    expect(storageConfiguration()).toMatchObject({ configured: true, valid: false });
  });

  it("decodes, strips metadata and re-encodes an uploaded branding image", async () => {
    const original = await sharp({ create: { width: 1200, height: 600, channels: 4, background: "#176b5b" } })
      .png().withMetadata({ density: 300 }).toBuffer();
    const output = await prepareBrandingImage({ name: "cover.png", type: "image/png", size: original.length,
      arrayBuffer: async () => original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) }, "cover");
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 1200, height: 600 });
    expect(metadata.density).toBeUndefined();
  });

  it("rejects SVG and mismatched file types", async () => {
    const bytes = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    await expect(prepareBrandingImage({ name: "logo.svg", type: "image/svg+xml", size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, "logo"))
      .rejects.toThrow(/JPG, PNG or WebP/);
  });
});
