import Link from "next/link";
export default function VenueNotFound() {
  return <main id="main-content" className="public-not-found">
    <p className="public-eyebrow">BOOKING PAGE UNAVAILABLE</p>
    <h1>We couldn’t find this venue.</h1>
    <p>The booking link may be incorrect, or this venue is not accepting bookings right now.</p>
    <Link href="/">Return to Slotra</Link>
  </main>;
}
