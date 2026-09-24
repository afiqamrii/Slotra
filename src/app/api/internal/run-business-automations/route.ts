import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runDueBusinessAutomations } from "@/lib/business-automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.BUSINESS_AUTOMATION_RUNNER_SECRET;
  if (!secret || secret.length < 32)
    return NextResponse.json({ error: "Automation runner is not configured" }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = Buffer.from(secret), actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runDueBusinessAutomations(getDb()));
  } catch {
    return NextResponse.json({ error: "Automation runner failed" }, { status: 500 });
  }
}
