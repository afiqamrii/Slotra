import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { developmentBillingEnabled } from "@/lib/subscription-provider";
import { handleSubscriptionWebhook } from "@/lib/subscription-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!developmentBillingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    return NextResponse.json(await handleSubscriptionWebhook(getDb(), await request.text(), request.headers.get("x-slotra-subscription-signature") ?? ""));
  } catch { return NextResponse.json({ error: "Subscription event rejected" }, { status: 400 }); }
}
