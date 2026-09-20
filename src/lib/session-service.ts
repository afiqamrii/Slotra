import { and, eq, ne } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { sessions } from "@/db/schema";
/* eslint-disable @typescript-eslint/no-explicit-any */
type Database = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function revokeSession(database: Database, userId: string, currentSessionId: string, targetId: string) {
  if (targetId === currentSessionId) return;
  await database.delete(sessions).where(and(eq(sessions.id, targetId), eq(sessions.userId, userId)));
}
export async function revokeOtherSessions(database: Database, userId: string, currentSessionId: string) {
  await database.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
}
export async function revokeAllSessions(database: Database, userId: string) {
  await database.delete(sessions).where(eq(sessions.userId, userId));
}
