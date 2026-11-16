import { validateRuntimeEnvironment } from "@/lib/runtime-config";

export function validateNodeRuntime() {
  // Builds remain credential-free; deployed Node runtime startup fails clearly for missing critical configuration.
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) validateRuntimeEnvironment();
}
