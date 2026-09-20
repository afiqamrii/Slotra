import "server-only";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Database = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function venueSchemaReady(database: Database) {
  const result = await database.execute(sql`select
    to_regclass('app.organization_sports') is not null
    and to_regclass('app.base_prices') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'app' and table_name = 'organizations'
        and column_name = 'onboarding_completed_at'
    ) as ready`);
  return result.rows[0]?.ready === true;
}

