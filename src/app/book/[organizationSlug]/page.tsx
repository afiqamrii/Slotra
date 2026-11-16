import { cache, type CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { getDb } from "@/db/client";
import { checkPublicRateLimit, publicAvailability, resolvePublicVenue } from "@/lib/public-booking";
import { localDateAt } from "@/lib/booking-time";
import { PublicBookingFlow } from "./public-booking-flow";
import { brand } from "@/lib/brand";
import { publicBookingUrl } from "@/lib/product-urls";

type Props = { params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ branch?: string; space?: string; page?: string }> };
const venueForRequest = cache((slug: string, branchId?: string) => resolvePublicVenue(getDb(), slug, branchId));
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { organizationSlug } = await params;
  const query = await searchParams;
  const venue = await venueForRequest(organizationSlug, query.branch);
  if (!venue) notFound();
  return { title: `Book a time at ${venue.name}`,
    description: venue.description || `Choose a sport, court and time at ${venue.name}. Book as a guest at this venue.`,
    alternates: { canonical: publicBookingUrl(venue.slug) }, openGraph: { url: publicBookingUrl(venue.slug) },
    robots: { index: true, follow: true } };
}
export default async function PublicVenuePage({ params, searchParams }: Props) {
  const { organizationSlug } = await params;
  const query = await searchParams;
  const venue = await venueForRequest(organizationSlug, query.branch);
  if (!venue) notFound();
  const today = localDateAt(new Date(), venue.timezone).toString();
  let initialGrid = null;
  let initialError: string | null = null;
  try {
    const requestHeaders = await headers();
    const ip = requestHeaders.get("x-real-ip") || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await checkPublicRateLimit(getDb(), `page:${createHash("sha256").update(ip).digest("hex")}`, 180, 300_000);
    initialGrid = await publicAvailability(getDb(), organizationSlug, {
      branchId: venue.branchId, sportId: venue.sports[0].id, localDate: today, durationMinutes: 60,
      page: query.page === undefined ? 1 : Number(query.page), resourceSearch: query.space,
    });
  } catch {
    initialError = "Times are temporarily unavailable. Please try again.";
  }
  const style = { "--public-accent": venue.color } as CSSProperties;
  return <div className="public-page" style={style}>
    <header className="public-header"><div className="public-shell public-header-inner">
      <Link className="public-identity" href={publicBookingUrl(venue.slug)}>
        {venue.logoUrl ? <Image src={venue.logoUrl} alt="" width={42} height={42} unoptimized /> :
          <span aria-hidden="true" className="public-identity-mark">{venue.name.slice(0, 2).toUpperCase()}</span>}
        <span>{venue.name}</span>
      </Link>
      {venue.contactPhone && <a className="public-contact-link" href={`tel:${venue.contactPhone.replace(/[^+0-9]/g, "")}`}>Contact venue</a>}
    </div></header>
    <main id="main-content" className="public-shell">
      <section className="public-hero">
        <div><p className="public-eyebrow">BOOK YOUR GAME</p><h1>Find your time to play.</h1>
          <p className="public-venue-line">{venue.name}{venue.city ? ` · ${venue.city}` : ""}{venue.state ? `, ${venue.state}` : ""}</p>
          {venue.description && <p className="public-description">{venue.description}</p>}
        </div>
        <div className="public-payment-pill">{venue.paymentOptions.length > 1 ? "Choose how to pay" : venue.paymentOptions[0]?.label ?? "Booking unavailable"}</div>
      </section>
      {venue.coverImageUrl && <div className="public-cover"><Image src={venue.coverImageUrl} alt="" fill unoptimized sizes="(max-width: 700px) 100vw, 1100px" /></div>}
      {venue.branches.length > 1 && <nav className="public-branch-picker" aria-label="Choose venue location">
        <h2>Choose a location</h2><div className="public-choice-row">{venue.branches.map(branch =>
          <Link key={branch.id} href={"?" + new URLSearchParams({ branch: branch.id })}
            className={branch.id === venue.branchId ? "public-choice active" : "public-choice"}
            aria-current={branch.id === venue.branchId ? "page" : undefined}>
            <span>{branch.name}</span>{branch.city && <small>{branch.city}</small>}
          </Link>)}</div><p>Booking times use the selected location’s timezone.</p>
      </nav>}
      <PublicBookingFlow key={venue.branchId} venue={venue} today={today} initialGrid={initialGrid} initialError={initialError} />
      {(Object.values(venue.policies).some(Boolean)) && <section aria-label="Venue policies">
        {([ ["cancellation", "Cancellation policy"], ["refund", "Refund policy"], ["rules", "Venue rules"] ] as const).map(([key, title]) =>
          venue.policies[key] && <details className="venue-policy" key={key}><summary>{title}</summary><p>{venue.policies[key]}</p></details>)}
      </section>}
    </main>
    <footer className="public-footer"><div className="public-shell"><span>{venue.name}</span><span>Times shown in {venue.timezone}</span>{!venue.hidePoweredBy && <span>Powered by {brand.name}</span>}</div></footer>
  </div>;
}





