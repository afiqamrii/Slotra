import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDatabaseUrl } from "@/db/env";
import * as schema from "@/db/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;
type DatabaseGlobals = typeof globalThis & {
  __slotraDatabase?: Database;
  __slotraPool?: Pool;
};

const databaseGlobals = globalThis as DatabaseGlobals;

export function getDb() {
  if (!databaseGlobals.__slotraDatabase) {
    const isProductionServerless = process.env.NODE_ENV === "production";
    const pool = databaseGlobals.__slotraPool ?? new Pool({
      connectionString: getDatabaseUrl(),
      max: isProductionServerless ? 1 : 5,
      idleTimeoutMillis: isProductionServerless ? 10_000 : 60_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      allowExitOnIdle: isProductionServerless,
    });
    databaseGlobals.__slotraPool = pool;
    databaseGlobals.__slotraDatabase = drizzle({ client: pool, schema });
  }
  return databaseGlobals.__slotraDatabase;
}
