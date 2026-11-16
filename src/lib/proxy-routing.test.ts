import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => { throw new Error("Database lookup is not expected"); } }));
import { config, proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());
const matches = (pathname: string) => unstable_doesMiddlewareMatch({ config, url: `https://unknown.example${pathname}` });

describe("tenant proxy static asset boundary", () => {
  it.each(["/images/venue-court.webp", "/images/another-shipped-photo.webp", "/_next/static/chunks/app.js",
    "/_next/image?url=%2Fimages%2Fvenue-court.webp&w=1080&q=75", "/favicon.ico", "/icon.svg"])
    ("lets Next serve shipped static asset %s without tenant-host middleware", pathname => {
      expect(matches(pathname)).toBe(false);
    });

  it.each(["/admin", "/dashboard", "/book/smash-arena", "/api/v1/bookings", "/api/branding/smash/logo/private.webp",
    "/api/exports/customers", "/api/images/private.webp", "/images-private/private.webp", "/_next/image-admin", "/reports/data.webp"])
    ("preserves host authorization for dynamic route %s", async pathname => {
      vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "false");
      expect(matches(pathname)).toBe(true);
      const response = await proxy(new NextRequest(`https://unknown.example${pathname}`, { headers: { host: "unknown.example" } }));
      expect(response.status).toBe(404);
    });
});
