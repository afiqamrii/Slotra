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
    const pool = databaseGlobals.__slotraPool ?? new Pool({
      connectionString: getDatabaseUrl(), max: 5, idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000, keepAlive: true,
    });
    databaseGlobals.__slotraPool = pool;
    databaseGlobals.__slotraDatabase = drizzle({ client: pool, schema });
  }
  return databaseGlobals.__slotraDatabase;
}
