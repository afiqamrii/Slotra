import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getDatabaseUrl } from "@/db/env";
import * as schema from "@/db/schema";

let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDb() {
  if (!database) {
    const pool = new Pool({ connectionString: getDatabaseUrl(), max: 5 });
    database = drizzle({ client: pool, schema });
  }
  return database;
}
