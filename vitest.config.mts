import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Each database suite owns a WASM PostgreSQL instance; bound parallelism for
  // reproducible memory use on developer machines and small CI runners.
  test: { include: ["src/**/*.test.ts"], maxWorkers: 2, testTimeout: 30000, hookTimeout: 30000 },
});

