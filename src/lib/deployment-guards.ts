import { databaseFingerprint } from "./runtime-config";
import { deploymentEnvironment } from "./deployment-environment";

type Environment = Record<string, string | undefined>;

function localDatabase(url: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
}

function matchesTarget(url: string, expected: string | undefined) {
  return Boolean(expected && /^[a-f0-9]{64}$/.test(expected) && databaseFingerprint(url) === expected);
}

/** Guard administrative scripts before opening any database connection. */
export function assertMigrationTarget(url: string, env: Environment = process.env) {
  const production = deploymentEnvironment(env) === "production";
  if (!localDatabase(url) || production) {
    if (!matchesTarget(url, env.MIGRATION_TARGET_FINGERPRINT)) {
      throw new Error("Migration target is not acknowledged. Verify the database and set MIGRATION_TARGET_FINGERPRINT.");
    }
  }
  if (production && env.ALLOW_PRODUCTION_MIGRATIONS !== "true") {
    throw new Error("Production migrations require reviewed SQL, a recovery plan, and ALLOW_PRODUCTION_MIGRATIONS=true.");
  }
  if (env.VERCEL_ENV === "preview" || env.DEPLOYMENT_ENV === "staging") {
    if (!env.PRODUCTION_DATABASE_FINGERPRINT || databaseFingerprint(url) === env.PRODUCTION_DATABASE_FINGERPRINT) {
      throw new Error("Staging migrations require a separate database and PRODUCTION_DATABASE_FINGERPRINT.");
    }
  }
}

export function assertSeedTarget(url: string, env: Environment = process.env) {
  if (env.NODE_ENV === "production" || env.DEPLOYMENT_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error("Demo seeds are unavailable in production.");
  }
  if (env.ALLOW_DEV_SEED !== "true" || !matchesTarget(url, env.SEED_DATABASE_FINGERPRINT)) {
    throw new Error("Demo seed requires ALLOW_DEV_SEED=true and an explicitly verified SEED_DATABASE_FINGERPRINT.");
  }
  if (!localDatabase(url) && env.ALLOW_REMOTE_DEV_SEED !== "true") {
    throw new Error("Remote demo seed requires ALLOW_REMOTE_DEV_SEED=true on an isolated test database.");
  }
  if (env.PRODUCTION_DATABASE_FINGERPRINT && databaseFingerprint(url) === env.PRODUCTION_DATABASE_FINGERPRINT) {
    throw new Error("Demo seeds cannot target the production database.");
  }
  if ((env.VERCEL_ENV === "preview" || env.DEPLOYMENT_ENV === "staging") && !env.PRODUCTION_DATABASE_FINGERPRINT) {
    throw new Error("Staging seed requires PRODUCTION_DATABASE_FINGERPRINT to reject the production target.");
  }
}
