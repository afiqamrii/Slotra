import { describe, expect, it } from "vitest";
import { assertMigrationTarget, assertSeedTarget } from "./deployment-guards";
import { databaseFingerprint } from "./runtime-config";

const local = "postgresql://tester:fixture@127.0.0.1:5432/slotra_test";
const staging = "postgresql://tester:fixture@staging.example.test:5432/slotra_test";
const production = "postgresql://tester:fixture@production.example.test:5432/slotra";

describe("administrative database target guards", () => {
  it("allows local migrations but refuses an unacknowledged remote target", () => {
    expect(() => assertMigrationTarget(local, {})).not.toThrow();
    expect(() => assertMigrationTarget(staging, {})).toThrow("not acknowledged");
    expect(() => assertMigrationTarget(staging, { MIGRATION_TARGET_FINGERPRINT: databaseFingerprint(production) })).toThrow();
  });
  it("requires explicit production migration authorization", () => {
    const env = { DEPLOYMENT_ENV: "production", MIGRATION_TARGET_FINGERPRINT: databaseFingerprint(production) };
    expect(() => assertMigrationTarget(production, env)).toThrow("ALLOW_PRODUCTION_MIGRATIONS");
    expect(() => assertMigrationTarget(production, { ...env, ALLOW_PRODUCTION_MIGRATIONS: "true" })).not.toThrow();
    expect(() => assertMigrationTarget(local, { NODE_ENV: "production" })).toThrow("not acknowledged");
  });
  it("rejects a staging migration to its known production target", () => {
    expect(() => assertMigrationTarget(production, { DEPLOYMENT_ENV: "staging",
      MIGRATION_TARGET_FINGERPRINT: databaseFingerprint(production),
      PRODUCTION_DATABASE_FINGERPRINT: databaseFingerprint(production) })).toThrow("separate database");
    expect(() => assertMigrationTarget(staging, { DEPLOYMENT_ENV: "staging",
      MIGRATION_TARGET_FINGERPRINT: databaseFingerprint(staging),
      PRODUCTION_DATABASE_FINGERPRINT: databaseFingerprint(production) })).not.toThrow();
  });
  it("requires the seed opt-in and matching target even for local fixtures", () => {
    expect(() => assertSeedTarget(local, {})).toThrow();
    expect(() => assertSeedTarget(local, { ALLOW_DEV_SEED: "true", SEED_DATABASE_FINGERPRINT: databaseFingerprint(local) })).not.toThrow();
  });
  it("never seeds a production environment and requires separate remote opt-in", () => {
    const env = { ALLOW_DEV_SEED: "true", SEED_DATABASE_FINGERPRINT: databaseFingerprint(staging) };
    expect(() => assertSeedTarget(staging, { ...env, DEPLOYMENT_ENV: "production" })).toThrow("unavailable in production");
    expect(() => assertSeedTarget(staging, { ...env, VERCEL_ENV: "production" })).toThrow();
    expect(() => assertSeedTarget(staging, env)).toThrow("ALLOW_REMOTE_DEV_SEED");
    expect(() => assertSeedTarget(staging, { ...env, ALLOW_REMOTE_DEV_SEED: "true" })).not.toThrow();
    expect(() => assertSeedTarget(staging, { ...env, ALLOW_REMOTE_DEV_SEED: "true",
      PRODUCTION_DATABASE_FINGERPRINT: databaseFingerprint(staging) })).toThrow("production database");
  });
});
