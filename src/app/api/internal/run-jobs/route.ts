import { getDb } from "@/db/client";
import { authorizedJobRequest, runBackgroundJobs, scheduledJobsConfiguration } from "@/lib/background-jobs";
import { logEvent } from "@/lib/structured-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizedJobRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!scheduledJobsConfiguration().enabled) return Response.json({ error: "Scheduled jobs are not configured" }, { status: 503 });
  try {
    const result = await runBackgroundJobs(getDb());
    return Response.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    logEvent("job.failed", { route: "/api/internal/run-jobs", code: "RUNNER_UNAVAILABLE" }, "error");
    return Response.json({ error: "Scheduled work could not be completed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const POST = GET;
