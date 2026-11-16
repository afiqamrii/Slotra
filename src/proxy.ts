import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations, tenantDomains } from "@/db/schema";
import { classifyHost, publicHostPath } from "@/lib/host-routing";
import { productUrls } from "@/lib/product-urls";

export async function proxy(request: NextRequest) {
  // The deployment edge must remove spoofed forwarding headers. Never resolve from X-Forwarded-Host.
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  const kind = classifyHost(host);
  const unavailable = () => new NextResponse("This address is unavailable.", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (kind === "shared" || kind === "app") return NextResponse.next();
  if (kind === "marketing") {
    if (["/login", "/register", "/dashboard"].includes(request.nextUrl.pathname))
      return NextResponse.redirect(new URL(request.nextUrl.pathname, productUrls.app));
    if (request.nextUrl.pathname === "/" || ["/terms", "/privacy", "/acceptable-use", "/api/health"].includes(request.nextUrl.pathname) ||
      request.nextUrl.pathname.startsWith("/_next/") || /\.(svg|png|webp|ico)$/.test(request.nextUrl.pathname)) return NextResponse.next();
    return unavailable();
  }
  let slug: string | undefined;
  if (kind === "unknown") {
    // Operator allowlist attests hostname/TLS provisioning; DNS-verified + active tenant record is still mandatory.
    const provisioned = (process.env.CUSTOM_DOMAIN_READY_HOSTS ?? "").split(",").map(value => value.trim().toLowerCase());
    if (process.env.CUSTOM_DOMAINS_ENABLED !== "true" || !provisioned.includes(host)) return unavailable();
    try {
      const [tenant] = await getDb().select({ slug: organizations.slug }).from(tenantDomains)
        .innerJoin(organizations, eq(tenantDomains.organizationId, organizations.id))
        .where(and(eq(tenantDomains.hostname, host), eq(tenantDomains.status, "VERIFIED"), eq(tenantDomains.isActive, true),
          eq(organizations.isActive, true))).limit(1);
      if (!tenant) return unavailable();
      slug = tenant.slug;
    } catch { return unavailable(); }
  }
  const path = publicHostPath(request.nextUrl.pathname, slug);
  if (!path) return unavailable();
  if (path === request.nextUrl.pathname) return NextResponse.next();
  const url = request.nextUrl.clone(); url.pathname = path;
  return NextResponse.rewrite(url);
}

// Next's local image optimizer dispatches public files internally without a Host
// header. Shipped static assets need no tenant lookup; every dynamic route,
// including published branding and other image APIs, retains host validation.
export const config = { matcher: "/((?!_next/static/|_next/image$|images/|favicon\\.ico$|icon\\.svg$).*)" };
