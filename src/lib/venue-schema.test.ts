import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { venueSchemaReady } from "@/lib/venue-schema";

describe("venue schema readiness", () => {
  it("detects the missing migration and becomes ready after migration 0003", async () => {
    const postgres = new PGlite();
    const db = drizzle({ client: postgres });
    try {
      for (const file of ["0000_talented_smiling_tiger", "0001_stormy_triathlon", "0002_funny_iceman"]) {
        const migration = readFileSync(resolve(`drizzle/${file}.sql`), "utf8");
        for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
      }
      expect(await venueSchemaReady(db)).toBe(false);
      const migration = readFileSync(resolve("drizzle/0003_panoramic_gravity.sql"), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await postgres.exec(statement);
      expect(await venueSchemaReady(db)).toBe(true);
    } finally { await postgres.close(); }
  });
});


