import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { runDueReports } from "@/lib/scheduled-reports";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.REPORT_RUNNER_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "Report runner is not configured" }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = Buffer.from(secret), actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runDueReports(getDb()));
  } catch {
    return NextResponse.json({ error: "Report runner failed" }, { status: 500 });
  }
}
