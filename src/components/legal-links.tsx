import Link from "next/link";
export function LegalLinks() { return <nav className="legal-links" aria-label="Legal information">
  <Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/acceptable-use">Acceptable use</Link>
</nav>; }
