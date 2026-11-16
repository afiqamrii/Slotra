import { spawnSync } from "node:child_process";
import { getDatabaseUrl } from "../src/db/env";
import { assertMigrationTarget } from "../src/lib/deployment-guards";

// A dedicated direct/session connection may differ from the application's transaction pooler.
if (process.env.MIGRATION_DATABASE_URL) process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
assertMigrationTarget(getDatabaseUrl());
const result = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], {
  stdio: "inherit", env: process.env,
});
if (result.error) throw new Error("The migration process could not start.");
process.exitCode = result.status ?? 1;
