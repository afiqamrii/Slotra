import Link from "next/link";
import { getDb } from "@/db/client";
import { requirePlatformAdministrator } from "@/lib/platform-authorization";
import { superAdminOrganizations } from "@/lib/super-admin-service";
export default async function AdminOrganizations({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const session = await requirePlatformAdministrator(), data = await superAdminOrganizations(getDb(), session.user.id, await searchParams);
  return <div className="foundation-page billing-page"><p className="eyebrow">SUPER ADMIN / ORGANIZATIONS</p><h1>Organizations</h1><p className="foundation-lead">Inspect subscriptions and help venues safely.</p>
    <form method="get" className="billing-inline-actions"><input name="search" aria-label="Search organizations" placeholder="Search venue name or slug" defaultValue={data.search} /><button className="button button-secondary">Search</button></form>
    <div className="foundation-card billing-table-scroll"><table className="billing-admin-table"><thead><tr><th>Venue</th><th>Plan</th><th>Subscription</th><th>Venue state</th><th>Created</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td><Link className="text-link" href={"/admin/organizations/" + row.id}>{row.name}</Link><small>{row.slug}</small></td><td>{row.planCode ?? "Unassigned"}<small>{row.provider}</small></td><td>{row.status}</td><td>{row.lifecycleStatus}</td><td>{row.createdAt.toLocaleDateString("en-MY")}</td></tr>)}</tbody></table>{!data.rows.length && <p className="billing-note">No organizations match this search.</p>}</div>
    <nav className="billing-inline-actions" aria-label="Organization pages">{data.page > 1 && <Link className="button button-secondary" href={"?" + new URLSearchParams({ page: String(data.page - 1), search: data.search })}>Previous</Link>}{data.hasNext && <Link className="button button-secondary" href={"?" + new URLSearchParams({ page: String(data.page + 1), search: data.search })}>Next</Link>}</nav></div>;
}
