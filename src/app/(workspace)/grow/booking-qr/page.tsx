import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { organizations } from "@/db/schema";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";

export const metadata: Metadata = { title: "Booking QR" };
export default async function VenueQrPage() {
  const { organization } = await requirePermission("organization:view");
  const db = getDb(), orgId = organization.organizationId;
  if (!await hasOrganizationFeature(db, orgId, "QR_CHECK_IN")) redirect("/grow");
  const [venue] = await db.select({ slug: organizations.slug, name: organizations.name })
    .from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const url = venue?.slug ? new URL("/book/" + venue.slug, process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString() : null;
  const qr = url ? await QRCode.toDataURL(url, { width: 360, margin: 3 }) : null;
  return <div className="foundation-page grow-page"><Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / QR</p><h1>Scan to book</h1>
    <p className="foundation-lead">Put this QR at your front desk. It opens your public booking page; it does not expose internal settings.</p>
    {qr && <section className="foundation-card grow-form-card"><h2>{venue.name}</h2>
      <Image src={qr} alt="QR code for venue booking page" width={360} height={360} unoptimized />
      <p><Link href={url!}>{url}</Link></p>
      <a className="button button-secondary" href={qr} download={venue.slug + "-booking-qr.png"}>Download PNG</a>
    </section>}
    {!qr && <p className="grow-empty">Set up a public booking slug to generate your QR.</p>}
  </div>;
}
