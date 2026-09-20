"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { NavigationLinks } from "@/components/navigation-links";
import { CurrentPlanBadge } from "@/components/current-plan-badge";
import type { StandardPlan } from "@/lib/plan-entitlements";

export function MobileNavigation({ plan }: { plan: StandardPlan }) {
  const pathname = usePathname();

  return (
    <details
      className="mobile-menu"
      key={pathname}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false;
        }
      }}
    >
      <summary aria-label="Workspace navigation" className="mobile-menu-toggle">
        <Menu aria-hidden="true" size={21} />
      </summary>
      <div className="mobile-menu-panel">
        <div className="mobile-plan"><span>YOUR PLAN</span><CurrentPlanBadge plan={plan} /></div>
        <p className="sidebar-label">WORKSPACE</p>
        <NavigationLinks />
      </div>
    </details>
  );
}
