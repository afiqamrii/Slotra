// Legacy scheduler URL: the centralized dispatcher owns authentication and idempotency.
export { POST } from "@/app/api/internal/run-jobs/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
