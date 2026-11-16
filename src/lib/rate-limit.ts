import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { rateLimits } from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
type RateLimitDatabase = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Consumes one request from a persistent, deployment-safe fixed window.
 * Callers receive only an allow/deny result so domain-specific errors remain friendly.
 */
export async function consumeRateLimit(database: RateLimitDatabase, namespace: string, identity: string,
  limit: number, windowMs: number, now = Date.now()) {
  const key = `${namespace}:${createHash("sha256").update(identity).digest("hex")}`;
  const cutoff = now - windowMs;
  const [state] = await database.insert(rateLimits).values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({ target: rateLimits.key, set: {
      count: sql`case when ${rateLimits.lastRequest} <= ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
      // Keep the window anchor stable, including when a request is denied. Moving it
      // on every retry would require a completely idle window before recovery.
      lastRequest: sql`case when ${rateLimits.lastRequest} <= ${cutoff} then ${now} else ${rateLimits.lastRequest} end`,
    } }).returning({ count: rateLimits.count });
  return state.count <= limit;
}
