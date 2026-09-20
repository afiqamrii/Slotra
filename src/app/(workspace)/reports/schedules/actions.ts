"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { createReportSchedule, setReportScheduleActive } from "@/lib/scheduled-reports";
import { isRole } from "@/lib/permissions";

export async function addReportSchedule(form: FormData) {
  const { organization, session, member } = await requirePermission("report:manage_schedule");
  if (!isRole(member.role)) redirect("/reports/schedules?error=permission");
  try {
    await createReportSchedule(getDb(), organization.organizationId, session.user.id, member.role, {
      name: form.get("name"), reportType: form.get("reportType"), frequency: form.get("frequency"),
      recipients: String(form.get("recipients") ?? "").split(",").map(item => item.trim()).filter(Boolean),
    });
  } catch {
    redirect("/reports/schedules?error=details");
  }
  revalidatePath("/reports/schedules");
  redirect("/reports/schedules?created=1");
}
export async function changeReportSchedule(form: FormData) {
  const { organization, member } = await requirePermission("report:manage_schedule");
  if (!isRole(member.role)) redirect("/reports/schedules?error=permission");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "true";
  try {
    await setReportScheduleActive(getDb(), organization.organizationId, member.role, id, active);
  } catch {
    redirect("/reports/schedules?error=not-found");
  }
  revalidatePath("/reports/schedules");
  redirect("/reports/schedules");
}
