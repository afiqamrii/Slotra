import { deploymentEnvironment, type Environment } from "@/lib/deployment-environment";
import { resolveProductUrls } from "@/lib/product-urls";

export function configuredHosts(env: Environment = process.env) {
  const urls = resolveProductUrls(env);
  const values = [urls.app, urls.booking, urls.marketing, env.BETTER_AUTH_URL];
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) values.push(`https://${env.VERCEL_URL}`);
  return new Set(values.flatMap(value => { try { return [new URL(value!).host.toLowerCase()]; } catch { return []; } }));
}

export function classifyHost(raw: string | null, env: Environment = process.env) {
  if (!raw || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(raw)) return "unknown" as const;
  const host = raw.toLowerCase();
  if (deploymentEnvironment(env) === "development" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return "shared" as const;
  if (!configuredHosts(env).has(host)) return "unknown" as const;
  const urls = resolveProductUrls(env);
  const match = (value: string) => new URL(value).host.toLowerCase() === host;
  const app = match(urls.app), book = match(urls.booking), marketing = match(urls.marketing);
  if ([app, book, marketing].filter(Boolean).length > 1) return "shared" as const;
  if (book) return "booking" as const;
  if (marketing) return "marketing" as const;
  return "app" as const;
}

export function publicHostPath(path: string, slug?: string): string | null {
  if (path.startsWith("/_next/") || path.startsWith("/api/branding/") || ["/api/health", "/favicon.ico", "/icon.svg", "/robots.txt"].includes(path)) return path;
  if (["/terms", "/privacy", "/acceptable-use"].includes(path)) return path;
  if (slug) {
    if (path === "/") return `/book/${slug}`;
    if (path === `/book/${slug}` || path.startsWith(`/book/${slug}/`)) return path;
    if (/^\/confirmation\/[a-zA-Z0-9_-]+(?:\/calendar\.ics)?$/.test(path)) return `/book/${slug}${path}`;
    if (path === "/payment-return") return `/book/${slug}/payment-return`;
    return null;
  }
  const requestedSlug = path.split("/")[1];
  if (["admin", "api", "app", "auth", "book", "dashboard", "help", "login", "register", "settings", "setup", "support", "www"].includes(requestedSlug)) return null;
  if (/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:(?:\/confirmation\/[a-zA-Z0-9_-]+(?:\/calendar\.ics)?)|\/payment-return)?$/.test(path)) return `/book${path}`;
  if (/^\/book\/[a-z0-9]+(?:-[a-z0-9]+)*(?:(?:\/confirmation\/[a-zA-Z0-9_-]+(?:\/calendar\.ics)?)|\/payment-return)?$/.test(path)) return path;
  return null;
}
