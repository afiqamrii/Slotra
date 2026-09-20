import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { MobileNavigation } from "@/components/mobile-navigation";
import { switchOrganizationAction } from "@/app/actions/organization";
import { SignOutButton } from "@/components/sign-out-button";
import { hasPermission } from "@/lib/permissions";
import type { StandardPlan } from "@/lib/plan-entitlements";

export function TopBar({ organization, memberships, userName, plan }: {
  organization: { organizationId: string; name: string; role: string };
  memberships: { organizationId: string; name: string }[];
  userName: string; plan: StandardPlan;
}) {
  return <header className="top-bar">
    <div className="top-bar-start">
      <MobileNavigation plan={plan} />
      <form action={switchOrganizationAction} className="organization-switch-form">
        <span aria-hidden="true" className="venue-avatar">{organization.name.slice(0, 2).toUpperCase()}</span>
        <label className="venue-switcher-copy" htmlFor="organizationId"><strong>Organization</strong><small>Current workspace</small></label>
        <select aria-label="Current organization" defaultValue={organization.organizationId} id="organizationId" name="organizationId">
          {memberships.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.name}</option>)}
        </select>
        <button className="switch-submit" type="submit">Switch <ChevronDown aria-hidden size={14} /></button>
      </form>
    </div>
    <div className="top-bar-end">{hasPermission(organization.role, "booking:create") && <Link className="button button-primary top-booking-button" href="/bookings/new">New Booking</Link>}<span className="account-name">{userName}</span><Link className="top-link" href="/account/security">Account</Link><SignOutButton /></div>
  </header>;
}
