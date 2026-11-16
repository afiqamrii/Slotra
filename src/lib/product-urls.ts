import type { Environment } from "@/lib/deployment-environment";

function origin(value: string | undefined, fallback: string) {
  try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.origin : fallback; }
  catch { return fallback; }
}

export function normalizeProductDomain(value: string | undefined) {
  const domain = value?.trim().toLowerCase().replace(/\.$/, "");
  if (!domain || domain.length > 253 || domain.includes(":") || domain.includes("/") || domain.split(".").length < 2) return null;
  return domain.split(".").every(label => label.length >= 1 && label.length <= 63 &&
    /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ? domain : null;
}

export function resolveProductUrls(env: Environment) {
  const domain = normalizeProductDomain(env.NEXT_PUBLIC_PRODUCT_DOMAIN);
  if (domain) return { marketing: `https://${domain}`, app: `https://app.${domain}`, booking: `https://book.${domain}` };
  const app = origin(env.NEXT_PUBLIC_APP_URL, "http://localhost:3000");
  return { app, booking: origin(env.NEXT_PUBLIC_BOOKING_URL, app), marketing: origin(env.NEXT_PUBLIC_MARKETING_URL, app) };
}

export const productUrls = resolveProductUrls({
  NEXT_PUBLIC_PRODUCT_DOMAIN: process.env.NEXT_PUBLIC_PRODUCT_DOMAIN,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_BOOKING_URL: process.env.NEXT_PUBLIC_BOOKING_URL,
  NEXT_PUBLIC_MARKETING_URL: process.env.NEXT_PUBLIC_MARKETING_URL,
});

export function publicBookingPath(slug: string) {
  return `${productUrls.booking === productUrls.app || productUrls.booking === productUrls.marketing ? "/book/" : "/"}${encodeURIComponent(slug)}`;
}
export function publicBookingUrl(slug: string) {
  // A dedicated booking host accepts /slug; shared/local hosts retain /book/slug.
  return new URL(publicBookingPath(slug), productUrls.booking).toString();
}
export function publicBookingConfirmationUrl(slug: string, token: string) {
  return new URL(`${publicBookingPath(slug)}/confirmation/${encodeURIComponent(token)}`, productUrls.booking).toString();
}
