import { z } from "zod";

const databaseUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.username && url.password && url.hostname);
});

export function isDatabaseUrlConfigured(value: string | undefined): boolean {
  const result = databaseUrl.safeParse(value);
  if (!result.success) return false;
  const url = new URL(result.data);
  return !["host", "example.com"].includes(url.hostname.toLowerCase()) &&
    !["user", "username"].includes(decodeURIComponent(url.username).toLowerCase()) &&
    !["password", "your-password", "your_database_password"].includes(decodeURIComponent(url.password).toLowerCase());
}

export function getDatabaseUrl(): string {
  if (!isDatabaseUrlConfigured(process.env.DATABASE_URL)) {
    throw new Error("DATABASE_URL is missing, malformed, or still contains example values. Use the PostgreSQL connection string from Supabase Connect.");
  }
  return process.env.DATABASE_URL!;
}
