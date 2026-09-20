import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { bookingSetup } from "@/lib/booking-management";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { csvDocument, exportBookings, exportCustomers, exportPayments, reportWindow } from "@/lib/starter-reporting";

export const dynamic = "force-dynamic";
const money = (minor: number) => (minor / 100).toFixed(2);

export async function GET(request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  if (!["bookings", "customers", "payments"].includes(dataset)) return new NextResponse("Not found", { status: 404 });
  const permission = dataset === "customers" ? "customer:view" : dataset === "payments" ? "payment:view" : "booking:view";
  const { organization, session } = await requirePermission(permission);
  const db = getDb();
  const organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "CSV_EXPORT")) return new NextResponse("Export unavailable", { status: 403 });
  let csv: string;
  try {
    if (dataset === "customers") {
      const rows = await exportCustomers(db, organizationId);
      csv = csvDocument(["Name", "Phone", "Email", "Booking count", "Booking value"],
        rows.map(row => [row.name, row.phone, row.email, row.bookings, money(row.bookingValue)]));
    } else {
      const setup = await bookingSetup(db, session.user.id, organizationId);
      const timezone = setup.branches[0]?.timezone ?? "Asia/Kuala_Lumpur";
      const url = new URL(request.url);
      const window = reportWindow({ range: url.searchParams.get("range") ?? "month",
        from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }, timezone);
      if (dataset === "bookings") {
        const rows = await exportBookings(db, organizationId, window.from, window.to);
        csv = csvDocument(["Reference", "Date", "Start", "End", "Court or space", "Customer", "Phone", "Status", "Source", "Total", "Paid", "Outstanding", "Currency"],
          rows.map(row => {
            const start = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(row.startAt);
            const time = (at: Date) => new Intl.DateTimeFormat("en-MY", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
            return [row.reference, start, time(row.startAt), time(row.endAt), row.resource, row.customer, row.phone,
              row.status, row.source, money(row.total), money(row.paid), money(Math.max(0, row.total - row.paid)), row.currency];
          }));
      } else {
        const rows = await exportPayments(db, organizationId, window.from, window.to);
        csv = csvDocument(["Booking reference", "Method", "Amount", "Status", "Date", "Currency"],
          rows.map(row => [row.reference, row.method, money(row.amount), row.status, row.at.toISOString(), row.currency]));
      }
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "ZodError" || error.message.startsWith("Choose ")))
      return new NextResponse("Choose a valid date range.", { status: 400 });
    throw error;
  }
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="slotra-${dataset}.csv"`, "Cache-Control": "private, no-store" } });
}
