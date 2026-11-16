"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function DashboardRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="dashboard-refresh" disabled={pending} aria-label="Refresh today’s operations"
    onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw size={14} aria-hidden />{pending ? "Refreshing…" : "Refresh"}
  </button>;
}
