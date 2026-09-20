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

type Props = { params: Promise<{ organizationSlug: string }> };
const venueForRequest = cache((slug: string) => resolvePublicVenue(getDb(), slug));
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { organizationSlug } = await params;
  const venue = await venueForRequest(organizationSlug);
  if (!venue) notFound();
  return { title: `Book a time at ${venue.name}`,
    description: `Choose a sport, court and time at ${venue.name}. Book as a guest at this venue.`,
    robots: { index: true, follow: true } };
}
export default async function PublicVenuePage({ params }: Props) {
  const { organizationSlug } = await params;
  const venue = await venueForRequest(organizationSlug);
  if (!venue) notFound();
  const today = localDateAt(new Date(), venue.timezone).toString();
  let initialGrid = null;
  let initialError: string | null = null;
  try {
    const requestHeaders = await headers();
    const ip = requestHeaders.get("x-real-ip") || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await checkPublicRateLimit(getDb(), `page:${createHash("sha256").update(ip).digest("hex")}`, 180, 300_000);
    initialGrid = await publicAvailability(getDb(), organizationSlug, {
      sportId: venue.sports[0].id, localDate: today, durationMinutes: 60,
    });
  } catch {
    initialError = "Times are temporarily unavailable. Please try again.";
  }
  const style = { "--public-accent": venue.color } as CSSProperties;
  return <div className="public-page" style={style}>
    <header className="public-header"><div className="public-shell public-header-inner">
      <Link className="public-identity" href={`/book/${venue.slug}`}>
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
        </div>
        <div className="public-payment-pill">{venue.paymentOptions.length > 1 ? "Choose how to pay" : venue.paymentOptions[0]?.label ?? "Booking unavailable"}</div>
      </section>
      <PublicBookingFlow venue={venue} today={today} initialGrid={initialGrid} initialError={initialError} />
    </main>
    <footer className="public-footer"><div className="public-shell"><span>{venue.name}</span><span>Times shown in {venue.timezone}</span></div></footer>
  </div>;
}





