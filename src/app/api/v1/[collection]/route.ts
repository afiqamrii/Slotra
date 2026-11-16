import { and, asc, eq, exists, gte, ilike, lt, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getDb } from "@/db/client";
import { bookings, branches, customers, resources, sportTypes } from "@/db/schema";
import { availableSlotsForResources, BookingError } from "@/lib/booking-availability";
import { createBooking } from "@/lib/booking-service";
import { authenticateApiKey, type ApiScope } from "@/lib/pro-api-service";
import { recordAudit } from "@/lib/pro-access-service";
import { queueOutboundEvent } from "@/lib/pro-webhooks";
import { logEvent } from "@/lib/structured-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const collections = ["bookings", "customers", "resources", "availability"] as const;
type Collection = typeof collections[number];
type Context = { params: Promise<{ collection: string }> };
const error = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });
const pageInput = z.coerce.number().int().min(1).max(1000).default(1);
const uuid = z.uuid();

async function access(request: Request, collection: string, method: "read" | "write") {
  if (!collections.includes(collection as Collection) || (collection === "availability" && method === "write") ||
    (collection === "resources" && method === "write")) return null;
  const scope = `${collection}:${method}` as ApiScope;
  return authenticateApiKey(getDb(), request.headers.get("authorization"), scope);
}

function authError(result: { reason: string } | null) {
  if (result?.reason === "RATE_LIMITED") return error("RATE_LIMITED", "Rate limit reached. Try again next minute.", 429);
  if (result?.reason === "WRONG_SCOPE") return error("INSUFFICIENT_SCOPE", "This key does not have the required scope.", 403);
  return error("UNAUTHORIZED", "A valid Pro API key is required.", 401);
}

export async function GET(request: Request, context: Context) {
  try {
    const { collection } = await context.params;
    const key = await access(request, collection, "read");
    if (!key?.ok) return authError(key);
    const db = getDb();
    const url = new URL(request.url);
    const requestedBranch = url.searchParams.get("branchId");
    if (requestedBranch && !uuid.safeParse(requestedBranch).success) return error("INVALID_BRANCH", "Invalid branch ID.", 400);
    if (key.branchId && requestedBranch && key.branchId !== requestedBranch)
      return error("FORBIDDEN_BRANCH", "This key is limited to another branch.", 403);
    const branchId = key.branchId ?? requestedBranch;
    if (branchId) {
      const [branch] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.organizationId, key.organizationId),
        eq(branches.id, branchId))).limit(1);
      if (!branch) return error("INVALID_BRANCH", "Branch not found.", 404);
    }
    if (collection === "availability") {
      if (!branchId) return error("BRANCH_REQUIRED", "Choose a branch.", 400);
      const input = z.object({ localDate: z.iso.date(), durationMinutes: z.coerce.number().int().min(30).max(480),
        resourceIds: z.array(z.uuid()).min(1).max(20) }).parse({
        localDate: url.searchParams.get("date"), durationMinutes: url.searchParams.get("durationMinutes") ?? 60,
        resourceIds: url.searchParams.getAll("resourceId"),
      });
      const slots = await availableSlotsForResources(db, key.actorId, key.organizationId, {
        branchId, resourceIds: input.resourceIds, localDate: input.localDate, durationMinutes: input.durationMinutes,
      });
      return NextResponse.json({ data: slots });
    }
    const page = pageInput.parse(url.searchParams.get("page") ?? 1);
    const offset = (page - 1) * 50;
    if (collection === "resources") {
      const rows = await db.select({ id: resources.id, branchId: resources.branchId, name: resources.name,
        status: resources.status, sport: sportTypes.name, bookingIntervalMinutes: resources.bookingIntervalMinutes,
        minimumDurationMinutes: resources.minimumDurationMinutes })
        .from(resources).innerJoin(sportTypes, eq(resources.sportTypeId, sportTypes.id))
        .where(and(eq(resources.organizationId, key.organizationId), ...(branchId ? [eq(resources.branchId, branchId)] : [])))
        .orderBy(asc(resources.name)).limit(50).offset(offset);
      return NextResponse.json({ data: rows, page });
    }
    if (collection === "customers") {
      const search = z.string().trim().max(100).parse(url.searchParams.get("q") ?? "");
      const pattern = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const rows = await db.select({ id: customers.id, name: customers.name, phone: customers.phone,
        email: customers.email, createdAt: customers.createdAt }).from(customers)
        .where(and(eq(customers.organizationId, key.organizationId),
          ...(search ? [or(ilike(customers.name, pattern), ilike(customers.phone, pattern), ilike(customers.email, pattern))!] : []),
          ...(branchId ? [exists(db.select({ id: bookings.id }).from(bookings).where(and(
            eq(bookings.organizationId, key.organizationId), eq(bookings.customerId, customers.id),
            eq(bookings.branchId, branchId))))] : [])))
        .orderBy(asc(customers.name)).limit(50).offset(offset);
      return NextResponse.json({ data: rows, page });
    }
    const from = z.iso.datetime({ offset: true }).parse(url.searchParams.get("from") ?? new Date().toISOString());
    const to = z.iso.datetime({ offset: true }).parse(url.searchParams.get("to") ??
      new Date(Date.now() + 30 * 86_400_000).toISOString());
    if (new Date(to).getTime() - new Date(from).getTime() > 93 * 86_400_000)
      return error("RANGE_TOO_LARGE", "Choose a range of 93 days or less.", 400);
    const rows = await db.select({ id: bookings.id, reference: bookings.bookingReference,
      branchId: bookings.branchId, resourceId: bookings.resourceId, customerId: bookings.customerId,
      startAt: bookings.startAt, endAt: bookings.endAt, status: bookings.status, source: bookings.source,
      totalAmount: bookings.totalAmount, amountPaid: bookings.amountPaid, currency: bookings.currency })
      .from(bookings).where(and(eq(bookings.organizationId, key.organizationId),
        ...(branchId ? [eq(bookings.branchId, branchId)] : []), gte(bookings.startAt, new Date(from)),
        lt(bookings.startAt, new Date(to)))).orderBy(asc(bookings.startAt)).limit(50).offset(offset);
    return NextResponse.json({ data: rows, page });
  } catch (cause) {
    if (cause instanceof ZodError) return error("INVALID_REQUEST", "Check the query parameters.", 400);
    if (cause instanceof BookingError) return error(cause.code, cause.message, 400);
    logEvent("api.failed", { route: "/api/v1/[collection]", code: "UNAVAILABLE", status: 503 }, "error");
    return error("UNAVAILABLE", "The API is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { collection } = await context.params;
    const key = await access(request, collection, "write");
    if (!key?.ok) return authError(key);
    const db = getDb();
    const body = await request.json();
    if (collection === "customers") {
      if (key.branchId) return error("FORBIDDEN_BRANCH", "Customer creation requires an organization-wide key.", 403);
      const input = z.object({ name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(6).max(30).regex(/^[+0-9()\s-]+$/),
        email: z.email().optional() }).parse(body);
      const [customer] = await db.insert(customers).values({ organizationId: key.organizationId, ...input }).returning({
        id: customers.id, name: customers.name, phone: customers.phone, email: customers.email });
      await recordAudit(db, { organizationId: key.organizationId, action: "customer.created", entityType: "customer",
        entityId: customer.id, summary: "Customer created through API" });
      await queueOutboundEvent(db, key.organizationId, "customer.created", customer.id,
        `customer.created:${customer.id}`, { customerId: customer.id });
      return NextResponse.json({ data: customer }, { status: 201 });
    }
    const input = z.object({ branchId: z.uuid(), resourceId: z.uuid(), customerId: z.uuid().optional(),
      newCustomer: z.object({ name: z.string().trim().min(2), phone: z.string().trim().min(6),
        email: z.email().optional() }).optional(), startAt: z.iso.datetime({ offset: true }),
      endAt: z.iso.datetime({ offset: true }), notes: z.string().max(2000).optional() }).parse(body);
    if (key.branchId && input.branchId !== key.branchId)
      return error("FORBIDDEN_BRANCH", "This key is limited to another branch.", 403);
    const booking = await createBooking(db, key.actorId, key.organizationId, { ...input,
      startAt: new Date(input.startAt), endAt: new Date(input.endAt), source: "API" });
    return NextResponse.json({ data: { id: booking.id, reference: booking.bookingReference,
      status: booking.status, totalAmount: booking.totalAmount, currency: booking.currency } }, { status: 201 });
  } catch (cause) {
    if (cause instanceof ZodError || cause instanceof SyntaxError) return error("INVALID_REQUEST", "Check the request body.", 400);
    if (cause instanceof BookingError) return error(cause.code, cause.message, cause.code === "CONFLICT" ? 409 : 400);
    logEvent("api.failed", { route: "/api/v1/[collection]", code: "UNAVAILABLE", status: 503 }, "error");
    return error("UNAVAILABLE", "The API is temporarily unavailable.", 503);
  }
}
