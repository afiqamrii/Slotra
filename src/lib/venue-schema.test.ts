import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const healthFixture = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => healthFixture.database }));
vi.mock("@/lib/runtime-config", () => ({ runtimeConfigurationIssues: () => [] }));
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { venueSchemaReady } from "@/lib/venue-schema";
import { GET as health } from "@/app/api/health/route";

afterEach(() => vi.restoreAllMocks());

describe("venue schema readiness", () => {
  it("requires the current schema and reports incomplete migrations through health", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const postgres = new PGlite({ extensions: { btree_gist } });
    const db = drizzle({ client: postgres });
    healthFixture.database = db;
    try {
      const journal = JSON.parse(readFileSync(resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
      for (const { tag } of journal.entries) {
        const migration = readFileSync(resolve(`drizzle/${tag}.sql`), "utf8");
        for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean))
          await postgres.exec(statement);
        if (tag.startsWith("0003_") || tag.startsWith("0023_") || tag.startsWith("0024_")) {
          expect(await venueSchemaReady(db), `schema after ${tag}`).toBe(false);
          const response = await health();
          expect(response.status).toBe(503);
          expect(await response.json()).toEqual({ status: "unavailable" });
        }
      }
      expect(await venueSchemaReady(db)).toBe(true);
      const healthy = await health();
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toEqual({ status: "ok" });
      expect(healthy.headers.get("Cache-Control")).toBe("no-store");

      // Health bypasses the positive workspace cache and detects later schema drift.
      await postgres.exec("alter table app.organizations drop column venue_rules");
      const outdated = await health();
      expect(outdated.status).toBe(503);
      expect(await outdated.json()).toEqual({ status: "unavailable" });
      expect(await venueSchemaReady(db)).toBe(false);
    } finally { await postgres.close(); }
  }, 120000);

  it("returns a safe unavailable response when catalog inspection fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    healthFixture.database = { execute: async () => { throw new Error("private database connection detail"); } };
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private database connection detail");
  });
});


