"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, ShieldCheck, UsersRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { NavigationLinks } from "@/components/navigation-links";
import { CurrentPlanBadge } from "@/components/current-plan-badge";
import type { StandardPlan } from "@/lib/plan-entitlements";
import { switchBranchAction } from "@/app/actions/organization";

export function MobileNavigation({ plan, publicBookingHref, branchSelection }: { plan: StandardPlan;
  publicBookingHref?: string; branchSelection: { branches: { id: string; name: string; isActive: boolean }[];
    selected: string | null; canSwitch: boolean } }) {
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
        {branchSelection.canSwitch && <form action={switchBranchAction} className="mobile-branch-switch">
          <label htmlFor="mobile-branch">Branch</label><select id="mobile-branch" name="branchId" defaultValue={branchSelection.selected ?? "all"}>
            <option value="all">All branches</option>{branchSelection.branches.filter(branch => branch.isActive).map(branch =>
              <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select><button type="submit" className="text-button">Switch</button>
        </form>}
        <p className="sidebar-label">WORKSPACE</p>
        <NavigationLinks />
        <div className="mobile-menu-extras">
          <Link className={`nav-link${pathname === "/team" ? " nav-link-active" : ""}`} href="/team">
            <UsersRound aria-hidden="true" size={19} strokeWidth={1.8} /><span>Team</span>
          </Link>
          <Link className={`nav-link${pathname === "/account/security" ? " nav-link-active" : ""}`} href="/account/security">
            <ShieldCheck aria-hidden="true" size={19} strokeWidth={1.8} /><span>Account & sessions</span>
          </Link>
          {publicBookingHref ? <Link className="nav-link" href={publicBookingHref}>
            <ArrowUpRight aria-hidden="true" size={19} strokeWidth={1.8} /><span>View booking page</span>
          </Link> : null}
        </div>
      </div>
    </details>
  );
}
