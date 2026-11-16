import Link from "next/link";
import { Zap } from "lucide-react";
import { planCatalog } from "@/lib/plan-catalog";
import type { StandardPlan } from "@/lib/plan-entitlements";

export function CurrentPlanBadge({ plan, href }: { plan: StandardPlan; href?: string }) {
  const name = planCatalog[plan].name;
  const className = `sidebar-plan-badge sidebar-plan-${plan.toLowerCase()}`;
  const content = <>
    {plan !== "STARTER" && <Zap size={13} aria-hidden="true" />}
    <span>{name} plan</span>
  </>;
  return href ? <Link className={className} href={href} aria-label={`Current plan: ${name}. View plan and usage`}>{content}</Link> :
    <span className={className}>{content}</span>;
}
