import Link from "next/link";
import { requirePermission } from "@/lib/authorization";
import { inspectBrandingBucket } from "@/lib/branding-storage";
import { uploadBrandingAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function StoragePage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  await requirePermission("organization:update");
  const state = await inspectBrandingBucket(), query = await searchParams;
  return <div className="foundation-page"><Link href="/settings/integrations">← Integrations</Link>
    <p className="eyebrow">BOOKING PAGE</p><h1>Venue images</h1><p className="foundation-lead">A clear logo and cover help customers recognize your venue.</p>
    <section className="foundation-card"><h2>{state.status === "CONNECTED" ? "Branding uploads" : "Uploads need configuration"}</h2><p>{state.message}</p>
      {query.result && <p role="status" className={query.result === "saved" ? "form-success" : "form-alert"}>{query.result === "saved" ? "Your venue image was updated." : "Upload failed. Check the file type, size and storage connection, then try again."}</p>}
      {state.status === "CONNECTED" && <form action={uploadBrandingAction} className="billing-admin-form">
        <label>Image for<select name="kind"><option value="logo">Venue logo</option><option value="cover">Booking page cover</option></select></label>
        <label>Image<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label>
        <p className="small-note">JPG, PNG or WebP. Logo: up to 2 MB; cover: up to 5 MB. Images are resized and metadata is removed. Uploaded branding is public on your booking page.</p>
        <button className="button button-primary">Upload image</button></form>}
    </section></div>;
}
