import { getDb } from "@/db/client";
import { handleSandboxUpgradeCallback } from "@/lib/plan-upgrade-service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_TOYYIBPAY_SANDBOX !== "true")
    return new Response(null, { status: 404 });
  const raw = await request.text();
  try {
    const result = await handleSandboxUpgradeCallback(getDb(), raw);
    return Response.json({ accepted: true, status: result.status, duplicate: result.duplicate },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && (error.message === "Invalid ToyyibPay callback" || error.name === "ZodError"))
      return Response.json({ error: "Invalid callback" }, { status: 401 });
    return Response.json({ error: "Could not verify sandbox payment" }, { status: 503 });
  }
}
