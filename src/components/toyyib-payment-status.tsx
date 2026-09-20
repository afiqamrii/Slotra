"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkToyyibSandboxPaymentAction } from "@/app/actions/public-booking";

export function ToyyibPaymentStatus({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div>
    <button type="button" className="public-secondary" disabled={pending} onClick={() => {
      setError(null);
      startTransition(async () => {
        const result = await checkToyyibSandboxPaymentAction(slug, token);
        setError(result.error);
        if (!result.error) router.refresh();
      });
    }}>{pending ? "Checking payment…" : "Check payment status"}</button>
    {error && <p className="public-error" role="status">{error}</p>}
  </div>;
}