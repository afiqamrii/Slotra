"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePlatformAdministrator } from "@/lib/platform-authorization";
import { captureOperationalError, monitoringConfiguration } from "@/lib/monitoring";
import { checkPublicRateLimit } from "@/lib/public-booking";

export async function sendMonitoringTest() {
  const session = await requirePlatformAdministrator();
  if (!monitoringConfiguration().valid) redirect("/admin/integrations?monitoring=unconfigured");
  let outcome = "failed";
  try {
    await checkPublicRateLimit(getDb(), `monitoring-test:${session.user.id}`, 3, 3_600_000);
    const result = await captureOperationalError("monitoring.test", { code: "ADMIN_TEST_EVENT" });
    outcome = result.accepted ? "accepted" : "failed";
  } catch { /* Return a safe result without provider or database details. */ }
  redirect(`/admin/integrations?monitoring=${outcome}`);
}
