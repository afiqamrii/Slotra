import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { WorkspaceCommandMenu } from "@/components/workspace-command-menu";
import { MobileNavigation } from "@/components/mobile-navigation";
import { switchBranchAction, switchOrganizationAction } from "@/app/actions/organization";
import { SignOutButton } from "@/components/sign-out-button";
import type { StandardPlan } from "@/lib/plan-entitlements";

export function TopBar({ organization, memberships, userName, plan, publicBookingHref, branchSelection, canCreateBooking,
  allowedHrefs, teamVisible, planHref }: {
  organization: { organizationId: string; name: string; role: string };
  memberships: { organizationId: string; name: string }[];
  userName: string; plan: StandardPlan; publicBookingHref?: string;
  canCreateBooking: boolean;
  allowedHrefs: readonly string[]; teamVisible: boolean; planHref?: string;
  branchSelection: { branches: { id: string; name: string; isActive: boolean }[]; selected: string | null; canSwitch: boolean; canViewAll: boolean };
}) {
  return <header className="top-bar">
    <div className="top-bar-start">
      <MobileNavigation plan={plan} publicBookingHref={publicBookingHref} branchSelection={branchSelection}
        organization={organization} memberships={memberships} allowedHrefs={allowedHrefs} teamVisible={teamVisible} planHref={planHref} />
      <div className="current-venue" title={organization.name}>
        <span aria-hidden="true" className="venue-avatar">{organization.name.slice(0, 2).toUpperCase()}</span>
        <strong className="current-venue-name">{organization.name}</strong>
      </div>
      {memberships.length > 1 && <form action={switchOrganizationAction} className="organization-switch-form desktop-organization-switch">
        <label className="sr-only" htmlFor="organizationId">Organization</label>
        <select aria-label="Current organization" defaultValue={organization.organizationId} id="organizationId" name="organizationId">
          {memberships.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.name}</option>)}
        </select>
        <button className="switch-submit" type="submit">Switch <ChevronDown aria-hidden size={14} /></button>
      </form>}
      {branchSelection.canSwitch && <form action={switchBranchAction} className="organization-switch-form branch-switch-form">
        <label className="sr-only" htmlFor="branchId">Branch</label>
        <select aria-label="Current branch" id="branchId" name="branchId" defaultValue={branchSelection.selected ?? "all"}>
          {branchSelection.canViewAll && <option value="all">All branches</option>}{branchSelection.branches.filter(branch => branch.isActive).map(branch =>
            <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select><button className="switch-submit" type="submit">Switch <ChevronDown aria-hidden size={14} /></button>
      </form>}
    </div>
    <div className="top-bar-end"><WorkspaceCommandMenu allowedHrefs={allowedHrefs} canCreateBooking={canCreateBooking} teamVisible={teamVisible} branchId={branchSelection.selected && branchSelection.selected !== "all" ? branchSelection.selected : undefined} />{canCreateBooking && <Link className="button button-primary top-booking-button" href="/bookings/new">New Booking</Link>}<span className="account-name">{userName}</span><Link className="top-link" href="/account/security">Account</Link><SignOutButton /></div>
  </header>;
}
