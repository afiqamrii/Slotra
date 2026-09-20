import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./src/db/env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(process.argv.includes("migrate") ? { dbCredentials: { url: getDatabaseUrl() } } : {}),
});
