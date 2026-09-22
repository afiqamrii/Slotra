import "server-only";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Database = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const readinessByDatabase = new WeakMap<object, Promise<boolean>>();

export function venueSchemaReady(database: Database) {
  let readiness = readinessByDatabase.get(database);
  if (!readiness) {
    readiness = database.execute(sql`select
      to_regclass('app.organization_sports') is not null
      and to_regclass('app.base_prices') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'app' and table_name = 'organizations'
          and column_name = 'onboarding_completed_at'
      ) as ready`).then(result => {
        const ready = result.rows[0]?.ready === true;
        if (!ready) readinessByDatabase.delete(database);
        return ready;
      }, error => {
        readinessByDatabase.delete(database);
        throw error;
      });
    readinessByDatabase.set(database, readiness);
  }
  return readiness;
}

