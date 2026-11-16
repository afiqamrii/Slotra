import Link from "next/link";
import { requirePermission } from "@/lib/authorization";

export default async function ApiGuidePage() {
  await requirePermission("integration:manage");
  return <div className="foundation-page pro-settings-page"><Link className="text-link" href="/settings/integrations">← Integrations</Link>
    <p className="eyebrow">DEVELOPER GUIDE / V1</p><h1>Slotra API</h1>
    <p className="foundation-lead">Use a dedicated Pro API key. Keep it on your server; never put it in a website or mobile app bundle.</p>
    <section className="foundation-card"><h2>Authentication</h2><p>Send <code>Authorization: Bearer YOUR_KEY</code> with every request. Keys are shown once, hashed at rest, and can be revoked.</p>
      <p>Branch-limited keys can only access their assigned branch. No browser session cookie is accepted by these endpoints.</p></section>
    <section className="foundation-card"><h2>Endpoints</h2><div className="data-list">
      {["GET /api/v1/bookings", "POST /api/v1/bookings", "GET /api/v1/customers", "POST /api/v1/customers",
        "GET /api/v1/resources", "GET /api/v1/availability"].map(endpoint =>
        <div className="data-row" key={endpoint}><strong>{endpoint}</strong></div>)}</div>
      <p>List endpoints return up to 50 records per page. Use <code>?page=2</code> for the next page. Booking dates are ISO timestamps with an offset.</p></section>
    <section className="foundation-card"><h2>Example: find available times</h2><pre className="pro-code-sample">{`curl -H "Authorization: Bearer YOUR_KEY" \\
  "https://YOUR_SLOTTRA_HOST/api/v1/availability?branchId=BRANCH_UUID&resourceId=SPACE_UUID&date=2026-10-05&durationMinutes=60"`}</pre>
      <p>Always quote again before creating a booking. The booking engine recalculates price and rejects conflicts on the server.</p></section>
    <section className="foundation-card"><h2>Errors & limits</h2><p>Errors use <code>{`{"error":{"code":"...","message":"..."}}`}</code>.
      Missing keys return 401, insufficient scopes 403, conflicts 409, and rate limits 429. Each key permits 120 requests per minute.</p>
      <p>See the repository’s <code>docs/API.md</code> for request bodies, scopes, versioning, and security details.</p></section>
  </div>;
}
