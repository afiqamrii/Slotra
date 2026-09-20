import Link from "next/link";
import { brand } from "@/lib/brand";

export function BrandLogo({ href = "/" }: { href?: string }) {
  return (
    <Link aria-label={`${brand.name} home`} className="brand-logo" href={href}>
      {brand.name}
    </Link>
  );
}
