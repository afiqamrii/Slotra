import { describe, expect, it } from "vitest";
import { isDatabaseUrlConfigured } from "@/db/env";

describe("database connection configuration", () => {
  it("rejects an example connection even when its URL syntax is valid", () => {
    expect(isDatabaseUrlConfigured("postgresql://USER:PASSWORD@HOST:5432/postgres")).toBe(false);
    expect(isDatabaseUrlConfigured("postgresql://postgres:YOUR_DATABASE_PASSWORD@db.example.supabase.co:5432/postgres")).toBe(false);
  });
  it("accepts a real-looking PostgreSQL URL without exposing it", () => {
    expect(isDatabaseUrlConfigured("postgresql://postgres:encoded%40secret@db.example.supabase.co:5432/postgres")).toBe(true);
  });
});
