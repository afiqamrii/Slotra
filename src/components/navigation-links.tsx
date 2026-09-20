"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/lib/navigation";

export function NavigationLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {navigation.map(({ label, href, icon: Icon }) => (
        <Link
          aria-current={pathname === href ? "page" : undefined}
          className={`nav-link${pathname === href ? " nav-link-active" : ""}`}
          href={href}
          key={href}
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
