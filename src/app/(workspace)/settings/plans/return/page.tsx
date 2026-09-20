import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { reconcileSandboxUpgrade, sandboxUpgradeStatus } from "@/lib/plan-upgrade-service";

export const dynamic = "force-dynamic";
export default async function SandboxPlanReturn({ searchParams }: {
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const { organization } = await requirePermission("organization:view");
  const id = (await searchParams).attemptId;
  if (!id) notFound();
  let status: string;
  try {
    const attempt = await sandboxUpgradeStatus(getDb(), organization.organizationId, id);
    status = attempt.status;
    if (status === "PROCESSING") {
      try { status = (await reconcileSandboxUpgrade(getDb(), id)).status; }
      catch { status = "PROCESSING"; }
    }
  } catch { notFound(); }
  return <div className="foundation-page plan-compare-page"><p className="eyebrow">PLAN / TOYYIBPAY SANDBOX</p>
    <h1>{status === "PAID" ? "Professional is active" : status === "FAILED" ? "Test payment was not completed" : "Waiting for test payment"}</h1>
    <p className="foundation-lead">{status === "PAID" ?
      "ToyyibPay confirmed your sandbox payment. Your venue now has Professional access for testing." :
      status === "FAILED" ? "Your plan has not changed. You can try again from Plans." :
        "We have not received verified payment confirmation yet. The browser return alone never upgrades a plan."}</p>
    <div className="starter-head-actions"><Link className="button button-primary" href="/settings/plans">View plan</Link>
      {status === "PROCESSING" && <Link className="button button-secondary" href={`/settings/plans/return?attemptId=${encodeURIComponent(id)}`}>Check again</Link>}
      <Link className="button button-secondary" href="/dashboard">Dashboard</Link></div>
    <p className="pro-note">This is a one-time sandbox test, not a live monthly subscription or real charge.</p>
  </div>;
}
