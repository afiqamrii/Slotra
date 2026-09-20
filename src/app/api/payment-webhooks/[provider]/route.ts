import { getDb } from "@/db/client";
import { handleTestWebhook } from "@/lib/payment-service";
import { testPaymentsEnabled } from "@/lib/payment-policy";
import { handleToyyibSandboxCallback } from "@/lib/toyyibpay-service";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider === "toyyibpay-sandbox") {
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_TOYYIBPAY_SANDBOX !== "true")
      return new Response(null, { status: 404 });
    const raw = await request.text();
    try {
      const result = await handleToyyibSandboxCallback(getDb(), raw);
      return Response.json({ accepted: true, pending: result.pending, duplicate: result.duplicate },
        { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && (error.message === "Invalid ToyyibPay callback" || error.name === "ZodError"))
        return Response.json({ error: "Invalid callback" }, { status: 401 });
      return Response.json({ error: "Could not verify payment" }, { status: 503 });
    }
  }
  if (provider !== "test" || !testPaymentsEnabled()) return new Response(null, { status: 404 });
  const raw = await request.text();
  const signature = request.headers.get("x-slotra-test-signature") ?? "";
  try {
    const outcome = await handleTestWebhook(getDb(), raw, signature);
    return Response.json({ accepted: true, duplicate: outcome.duplicate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && (error.message === "Invalid test webhook" || error.name === "ZodError" || error instanceof SyntaxError))
      return Response.json({ error: "Invalid signature or event" }, { status: 401 });
    // Never echo provider payloads, credentials, or database errors.
    return Response.json({ error: "Could not process event" }, { status: 503 });
  }
}

