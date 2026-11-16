"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/lib/navigation";

function NavigationPendingIndicator() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`nav-link-pending${pending ? " is-pending" : ""}`} />;
}

export function NavigationLinks({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {navigation.filter(item => allowedHrefs.includes(item.href)).map(({ label, href, icon: Icon }) => (
        <Link
          aria-current={pathname === href ? "page" : pathname.startsWith(`${href}/`) ? "location" : undefined}
          className={`nav-link${pathname === href || pathname.startsWith(`${href}/`) ? " nav-link-active" : ""}`}
          href={href}
          key={href}
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>{label}</span>
          <NavigationPendingIndicator />
        </Link>
      ))}
    </nav>
  );
}
