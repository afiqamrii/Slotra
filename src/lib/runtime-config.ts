import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isDatabaseUrlConfigured } from "@/db/env";
import { deploymentEnvironment, isPreviewEnvironment, type Environment } from "@/lib/deployment-environment";
import { normalizeProductDomain, resolveProductUrls } from "@/lib/product-urls";

// Identifies the target without passwords. Pooler users contain the Supabase project ref.
export function databaseFingerprint(raw: string) {
  const url = new URL(raw);
  const directRef = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  const poolRef = url.hostname.endsWith(".pooler.supabase.com") ? decodeURIComponent(url.username).match(/\.([a-z0-9]+)$/)?.[1] : undefined;
  const target = directRef || poolRef ? `supabase:${directRef ?? poolRef}:${url.pathname}` :
    [url.hostname.toLowerCase(), url.port || "5432", decodeURIComponent(url.username), url.pathname].join("|");
  return bytesToHex(sha256(new TextEncoder().encode(target)));
}

function httpsOrigin(raw: string | undefined) {
  try { const url = new URL(raw ?? ""); return url.protocol === "https:" && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === "/" && !["localhost", "127.0.0.1", "example.com"].includes(url.hostname) &&
    !url.hostname.endsWith(".example.com"); } catch { return false; }
}

export function runtimeConfigurationIssues(env: Environment = process.env): string[] {
  const issues: string[] = [];
  const environment = deploymentEnvironment(env);
  if (!isDatabaseUrlConfigured(env.DATABASE_URL)) issues.push("DATABASE_URL must identify a configured PostgreSQL database.");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || /replace-with|example|your.secret/i.test(env.BETTER_AUTH_SECRET))
    issues.push("BETTER_AUTH_SECRET must be a unique secret of at least 32 characters.");
  if (environment === "development") return issues;
  if (!["staging", "production"].includes(env.DEPLOYMENT_ENV ?? "")) issues.push("DEPLOYMENT_ENV must explicitly name staging or production.");
  if (isPreviewEnvironment(env) && env.DEPLOYMENT_ENV !== "staging") issues.push("Vercel previews must use DEPLOYMENT_ENV=staging.");
  if (!httpsOrigin(env.BETTER_AUTH_URL)) issues.push("BETTER_AUTH_URL must be an explicit public HTTPS origin.");
  if (environment === "production") {
    const domain = normalizeProductDomain(env.NEXT_PUBLIC_PRODUCT_DOMAIN);
    if (!domain || domain.endsWith(".example") || domain.endsWith(".test"))
      issues.push("NEXT_PUBLIC_PRODUCT_DOMAIN must be the approved production root domain.");
    const urls = resolveProductUrls(env);
    if (httpsOrigin(env.BETTER_AUTH_URL) && new URL(env.BETTER_AUTH_URL!).origin !== urls.app)
      issues.push("BETTER_AUTH_URL must match the derived app product origin.");
    for (const [key, expected] of [["NEXT_PUBLIC_APP_URL", urls.app], ["NEXT_PUBLIC_BOOKING_URL", urls.booking],
      ["NEXT_PUBLIC_MARKETING_URL", urls.marketing]] as const)
      if (env[key] && (!httpsOrigin(env[key]) || new URL(env[key]!).origin !== expected))
        issues.push(`${key} conflicts with NEXT_PUBLIC_PRODUCT_DOMAIN.`);
  } else {
    for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BOOKING_URL", "NEXT_PUBLIC_MARKETING_URL"])
      if (!httpsOrigin(env[key])) issues.push(`${key} must be an explicit public HTTPS origin.`);
    if (httpsOrigin(env.BETTER_AUTH_URL) && httpsOrigin(env.NEXT_PUBLIC_APP_URL) &&
      new URL(env.BETTER_AUTH_URL!).origin !== new URL(env.NEXT_PUBLIC_APP_URL!).origin)
      issues.push("BETTER_AUTH_URL must match NEXT_PUBLIC_APP_URL.");
  }
  if (!/^[a-f0-9]{64}$/.test(env.EXPECTED_DATABASE_FINGERPRINT ?? ""))
    issues.push("EXPECTED_DATABASE_FINGERPRINT must be set from the independently verified target database.");
  if (isDatabaseUrlConfigured(env.DATABASE_URL)) {
    const fingerprint = databaseFingerprint(env.DATABASE_URL!);
    if (env.EXPECTED_DATABASE_FINGERPRINT && fingerprint !== env.EXPECTED_DATABASE_FINGERPRINT)
      issues.push("DATABASE_URL does not match the approved environment database target.");
    if (environment === "staging") {
      if (!/^[a-f0-9]{64}$/.test(env.PRODUCTION_DATABASE_FINGERPRINT ?? ""))
        issues.push("PRODUCTION_DATABASE_FINGERPRINT must be supplied as a staging denylist.");
      else if (fingerprint === env.PRODUCTION_DATABASE_FINGERPRINT)
        issues.push("Staging must not use the production database.");
    }
  }
  return issues;
}

export function validateRuntimeEnvironment(env: Environment = process.env) {
  const issues = runtimeConfigurationIssues(env);
  if (issues.length) throw new Error(`Deployment configuration incomplete: ${issues.join(" ")}`);
}
