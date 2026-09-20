import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { sweepExpiredHolds } from "@/lib/payment-service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.PAYMENT_HOLD_SWEEP_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !supplied || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)))
    return new Response(null, { status: 401 });
  try {
    const expired = await sweepExpiredHolds(getDb());
    return Response.json({ expired }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Hold expiry unavailable" }, { status: 503 });
  }
}

