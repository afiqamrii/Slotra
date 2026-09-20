"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { simulateTestPaymentAction } from "@/app/actions/public-booking";

export function TestPaymentSimulator({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div className="test-payment-panel">
    <strong>Development payment simulator</strong>
    <p>No real payment is made. These buttons send a signed test event through the same payment processor used by webhooks.</p>
    <div className="test-payment-actions">{([
      ["PAID", "Simulate payment received"], ["FAILED", "Simulate failure"], ["PROCESSING", "Leave pending"],
    ] as const).map(([status, label]) =>
      <button key={status} className={status === "PAID" ? "button button-primary" : "button button-secondary"}
        disabled={pending} type="button" onClick={() => startTransition(async () => {
          setError(null);
          const result = await simulateTestPaymentAction(slug, token, status);
          setError(result.error);
          if (!result.error) router.refresh();
        })}>{pending ? "Processing…" : label}</button>)}</div>
    {error && <p className="public-error" role="alert">{error}</p>}
  </div>;
}

