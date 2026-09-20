import Link from "next/link";
import { ArrowUpRight, UsersRound } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { NavigationLinks } from "@/components/navigation-links";
import { CurrentPlanBadge } from "@/components/current-plan-badge";
import type { StandardPlan } from "@/lib/plan-entitlements";

export function AppSidebar({ publicBookingHref, plan }: { publicBookingHref?: string; plan: StandardPlan }) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand"><BrandLogo href="/dashboard" /><CurrentPlanBadge plan={plan} /></div>
      <p className="sidebar-label">WORKSPACE</p>
      <NavigationLinks />
      <div className="sidebar-bottom"><Link className="sidebar-extra" href="/team"><UsersRound aria-hidden="true" size={18} /><span>Team</span></Link>
        {publicBookingHref && <Link className="sidebar-extra" href={publicBookingHref}>
          <ArrowUpRight aria-hidden="true" size={18} />
          <span>View booking page</span>
        </Link>}

      </div>
    </aside>
  );
}



