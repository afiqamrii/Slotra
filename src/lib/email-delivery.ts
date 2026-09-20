import "server-only";

export function emailReady() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }

export async function deliverEmail(input: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
  if (!emailReady()) return { status: process.env.NODE_ENV !== "production" ? "DEV_PREVIEW" as const : "FAILED" as const,
    reason: "Email provider is not configured", providerMessageId: null };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.to], subject: input.subject,
      html: input.html, text: input.text }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const data = await response.json() as { id?: string };
  return { status: "SENT" as const, reason: null, providerMessageId: data.id ?? null };
}

export function escapeEmailHtml(input: string) {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
