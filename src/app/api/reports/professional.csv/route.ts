import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { professionalReport } from "@/lib/professional-reporting";
import { csvDocument } from "@/lib/starter-reporting";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { organization } = await requirePermission("report:export");
  const db = getDb();
  const params = new URL(request.url).searchParams;
  try {
    const report = await professionalReport(db, organization.organizationId, {
      range: params.get("range") || undefined, from: params.get("from") || undefined,
      to: params.get("to") || undefined, sport: params.get("sport") || undefined,
      resource: params.get("resource") || undefined, status: params.get("status") || undefined,
    });
    const [venue] = await db.select({ currency: organizations.currency }).from(organizations)
      .where(eq(organizations.id, organization.organizationId)).limit(1);
    const section = params.get("section") ?? "overview";
    const prefix: unknown[][] = [["Venue", organization.name], ["Period", `${report.fromDate} to ${report.toDate}`],
      ["Timezone", report.timezone], ["Currency", venue?.currency ?? ""], ["Status filter", report.filter.status], []];
    let rows: unknown[][], headers: string[];
    if (section === "revenue") {
      headers = ["Local date", "Bookings", "Booking value (minor units)", "Collected (minor units)"];
      rows = report.series.map(point => [point.date, point.bookings, point.bookingValue, point.collected]);
    } else if (section === "bookings") {
      headers = ["Local date", "Bookings"];
      rows = report.series.map(point => [point.date, point.bookings]);
    } else if (section === "resources") {
      headers = ["Space", "Sport", "Booked minutes", "Available minutes", "Utilisation %", "Booking value (minor units)", "Collected (minor units)"];
      rows = report.utilization.resources.map(item => {
        const revenue = report.resourceRevenue.find(entry => entry.id === item.id);
        return [item.name, item.sportName, item.bookedMinutes, item.availableMinutes, item.percent ?? "",
          revenue?.bookingValue ?? 0, revenue?.collected ?? 0];
      });
    } else if (section === "customers") {
      headers = ["Customer", "Bookings", "Booking value (minor units)"];
      rows = report.customers.top.map(item => [item.name, item.bookings, item.bookingValue]);
    } else {
      headers = ["Metric", "Value"];
      rows = Object.entries(report.totals).map(([key, value]) => [key, value]);
      rows.push(["utilizationPercent", report.utilization.percent ?? ""],
        ["newCustomers", report.customers.new], ["returningCustomers", report.customers.returning]);
    }
    const csv = csvDocument(headers, rows);
    const preamble = csvDocument(["Field", "Value"], prefix);
    return new NextResponse(preamble + csv.replace(/^\uFEFF/, ""), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="slotra-${section}-${report.fromDate}-${report.toDate}.csv"`,
      "Cache-Control": "private, no-store",
    } });
  } catch {
    return NextResponse.json({ error: "Could not create this report. Check the filters and try again." }, { status: 400 });
  }
}
