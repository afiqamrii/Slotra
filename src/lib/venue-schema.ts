import "server-only";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable, type PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Database = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const readinessByDatabase = new WeakMap<object, Promise<boolean>>();
const requiredColumns = Object.values(schema).flatMap(value => {
  if (!is(value, PgTable)) return [];
  const table = getTableConfig(value);
  return table.schema === "app" ? table.columns.map(column => [table.name, column.name] as const) : [];
});

export function venueSchemaReady(database: Database, options: { refresh?: boolean } = {}) {
  let readiness = options.refresh ? undefined : readinessByDatabase.get(database);
  if (!readiness) {
    // Inspect catalog metadata only: querying a missing tenant column here would
    // prevent the application from showing the migration recovery notice.
    // The migration journal remains authoritative for indexes and constraints.
    readiness = database.execute(sql`select not exists (
      select 1 from (values ${sql.join(requiredColumns.map(([table, column]) => sql`(${table}, ${column})`), sql`, `)})
        as required(table_name, column_name)
      where not exists (select 1 from information_schema.columns actual
        where actual.table_schema = 'app' and actual.table_name = required.table_name
          and actual.column_name = required.column_name)
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

