import Link from "next/link";
import { Zap } from "lucide-react";
import { planCatalog } from "@/lib/plan-catalog";
import type { StandardPlan } from "@/lib/plan-entitlements";

export function CurrentPlanBadge({ plan }: { plan: StandardPlan }) {
  const name = planCatalog[plan].name;
  return <Link className={`sidebar-plan-badge sidebar-plan-${plan.toLowerCase()}`} href="/settings/plans" aria-label={`Current plan: ${name}. View plans`}>
    {plan !== "STARTER" && <Zap size={13} aria-hidden="true" />}
    <span>{name} plan</span>
  </Link>;
}
