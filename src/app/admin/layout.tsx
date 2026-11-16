import Link from "next/link";
import type { ReactNode } from "react";
import { requirePlatformAdministrator } from "@/lib/platform-authorization";
import { brand } from "@/lib/brand";
export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdministrator();
  return <div className="billing-admin-shell"><header className="billing-admin-nav"><div><Link href="/admin"><strong>{brand.name}</strong> / Platform</Link><Link href="/admin/organizations">Organizations</Link><Link href="/admin/integrations">Integrations</Link></div><Link className="text-link" href="/dashboard">Venue dashboard →</Link></header><main className="billing-admin-content" id="main-content">{children}</main></div>;
}
