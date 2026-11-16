import { getDb } from "@/db/client";
import { fetchPublishedBranding } from "@/lib/branding-storage";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; kind: string; filename: string }> }) {
  try {
    const { slug, kind, filename } = await params;
    const file = await fetchPublishedBranding(getDb(), slug, kind, filename);
    if (!file) return new Response(null, { status: 404 });
    return new Response(file.body, { headers: { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline", "Cache-Control": "public, max-age=300" } });
  } catch { return new Response(null, { status: 503 }); }
}
