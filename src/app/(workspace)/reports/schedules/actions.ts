"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { createReportSchedule, setReportScheduleActive } from "@/lib/scheduled-reports";

export async function addReportSchedule(form: FormData) {
  const { organization, session, member } = await requirePermission("report:manage_schedule");
  if (member.branchScope !== "ALL") redirect("/reports/schedules?error=permission");
  try {
    await createReportSchedule(getDb(), organization.organizationId, session.user.id, {
      name: form.get("name"), reportType: form.get("reportType"), frequency: form.get("frequency"),
      recipients: String(form.get("recipients") ?? "").split(",").map(item => item.trim()).filter(Boolean),
      branchId: form.get("branchId") && form.get("branchId") !== "all" ? form.get("branchId") : null,
    });
  } catch {
    redirect("/reports/schedules?error=details");
  }
  revalidatePath("/reports/schedules");
  redirect("/reports/schedules?created=1");
}
export async function changeReportSchedule(form: FormData) {
  const { organization, session, member } = await requirePermission("report:manage_schedule");
  if (member.branchScope !== "ALL") redirect("/reports/schedules?error=permission");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "true";
  try {
    await setReportScheduleActive(getDb(), organization.organizationId, session.user.id, id, active);
  } catch {
    redirect("/reports/schedules?error=not-found");
  }
  revalidatePath("/reports/schedules");
  redirect("/reports/schedules");
}
