import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { isDatabaseUrlConfigured } from "@/db/env";
import { createAuth } from "@/lib/auth-factory";
import { deliverAuthLink } from "@/lib/dev-mail";

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuthConfigurationIssue(): string | null {
  if (!isDatabaseUrlConfigured(process.env.DATABASE_URL)) {
    return "Database connection is not configured. Replace the example DATABASE_URL in .env.local with your Supabase PostgreSQL connection string.";
  }
  if (!z.string().min(32).safeParse(process.env.BETTER_AUTH_SECRET).success ||
    process.env.BETTER_AUTH_SECRET === "replace-with-a-unique-random-secret-at-least-32-characters") {
    return "BETTER_AUTH_SECRET must be a unique secret of at least 32 characters in .env.local.";
  }
  const origin = z.url().safeParse(process.env.BETTER_AUTH_URL);
  if (!origin.success || new URL(origin.data).hostname.endsWith(".supabase.co")) {
    return "BETTER_AUTH_URL must be this app's origin, such as http://localhost:3000, not the Supabase project URL.";
  }
  return null;
}

export function postgresErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let index = 0; index < 5 && current && typeof current === "object"; index++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

export async function getDevelopmentAuthReadinessIssue(): Promise<string | null> {
  const issue = getAuthConfigurationIssue();
  if (issue || process.env.NODE_ENV !== "development") return issue;
  try {
    const { getDb } = await import("@/db/client");
    await getDb().execute(sql`select 1`);
    return null;
  } catch (error) {
    if (postgresErrorCode(error) === "28P01") {
      return "Supabase rejected the database password in .env.local. Use the PostgreSQL password from the project's database settings.";
    }
    return "The app cannot connect to PostgreSQL. Check DATABASE_URL and that the database is reachable.";
  }
}

export async function getAuth() {
  if (instance) return instance;
  const issue = getAuthConfigurationIssue();
  if (issue) throw new Error(issue);
  const { getDb } = await import("@/db/client");
  instance = createAuth(getDb(), {
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,
    deliver: deliverAuthLink,
  });
  return instance;
}

export function isAuthConfigured() {
  return getAuthConfigurationIssue() === null;
}


