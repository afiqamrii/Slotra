import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateNodeRuntime } = await import("./instrumentation-node");
  validateNodeRuntime();
}

export const onRequestError: Instrumentation.onRequestError = async (_error, _request, context) => {
  const { captureOperationalError } = await import("@/lib/monitoring");
  await captureOperationalError("route.failed", { route: context.routePath, code: "UNHANDLED_SERVER_ERROR" });
};
