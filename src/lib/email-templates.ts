import { brand as platformBrand } from "@/lib/brand";

export type EmailTemplate = { subject: string; text: string; html: string };
export type EmailBranding = {
  name: string;
  accent?: string | null;
  logoUrl?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
};

export function escapeEmailHtml(input: string) {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeAccent(value?: string | null) {
  const candidate = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : platformBrand.accent;
  const channels = [1, 3, 5].map(index => {
    const channel = parseInt(candidate.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return 1.05 / (luminance + 0.05) >= 4.5 ? candidate : "#176b5b";
}

function safeLogo(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}

function emailDocument(input: { branding: EmailBranding; preview: string; title: string; intro: string;
  rows?: { label: string; value: string }[]; note?: string; footer?: string; action?: { label: string; url: string } }) {
  const accent = safeAccent(input.branding.accent), logo = safeLogo(input.branding.logoUrl);
  const rows = input.rows ?? [];
  const contact = [input.branding.contactPhone, input.branding.contactEmail].filter(Boolean).join(" · ");
  const text = [input.title, input.intro, ...rows.map(row => `${row.label}: ${row.value}`),
    input.action ? `${input.action.label}: ${input.action.url}` : null, input.note,
    input.footer, contact ? `Contact: ${contact}` : null].filter(Boolean).join("\n");
  const rowHtml = (rows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-collapse:collapse">${rows.map(row =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e5ebe8;color:#61706b;font-size:14px;vertical-align:top">${escapeEmailHtml(row.label)}</td><td style="padding:10px 0;border-bottom:1px solid #e5ebe8;color:#172b27;font-size:14px;font-weight:600;text-align:right;vertical-align:top">${escapeEmailHtml(row.value)}</td></tr>`).join("")}</table>` : "") +
    (input.action ? `<p style="margin:24px 0"><a href="${escapeEmailHtml(input.action.url)}" style="display:inline-block;padding:14px 20px;border-radius:8px;background:${accent};color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">${escapeEmailHtml(input.action.label)}</a></p>` : "");
  return { text, html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeEmailHtml(input.title)}</title></head><body style="margin:0;background:#f5f7f6;color:#172b27;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeEmailHtml(input.preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f6"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e1e7e4;border-radius:12px"><tr><td style="padding:28px 28px 12px">${logo ? `<img src="${escapeEmailHtml(logo)}" alt="" width="44" height="44" style="display:block;max-width:44px;max-height:44px;object-fit:contain;margin-bottom:16px">` : ""}<p style="margin:0;color:${accent};font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeEmailHtml(input.branding.name)}</p><h1 style="margin:12px 0 10px;font-size:26px;line-height:1.25;color:#172b27">${escapeEmailHtml(input.title)}</h1><p style="margin:0;color:#425650;font-size:16px;line-height:1.6">${escapeEmailHtml(input.intro)}</p>${rowHtml}${input.note ? `<p style="margin:20px 0 0;padding:14px;background:#f0f6f3;border-left:3px solid ${accent};color:#334b44;font-size:14px;line-height:1.55">${escapeEmailHtml(input.note)}</p>` : ""}</td></tr><tr><td style="padding:12px 28px 28px;color:#6b7975;font-size:12px;line-height:1.55">${input.footer ? `<p style="margin:0 0 8px">${escapeEmailHtml(input.footer)}</p>` : ""}${contact ? `<p style="margin:0">${escapeEmailHtml(contact)}</p>` : ""}</td></tr></table></td></tr></table></body></html>` };
}

export function bookingEmailTemplate(input: {
  event: "CONFIRMED" | "RESCHEDULED" | "CANCELLED";
  branding: EmailBranding; customerName: string; bookingReference: string; resourceName: string;
  date: string; time: string; total: string; paid: string; outstanding: string;
  paymentRequirement: string;
}): EmailTemplate {
  const titles = { CONFIRMED: "Booking confirmed", RESCHEDULED: "Booking updated", CANCELLED: "Booking cancelled" } as const;
  const title = titles[input.event];
  const rows = [{ label: "Booking reference", value: input.bookingReference }, { label: "Court or space", value: input.resourceName },
    { label: "Date", value: input.date }, { label: "Time", value: input.time }, { label: "Total", value: input.total },
    { label: "Paid", value: input.paid }];
  if (input.event !== "CANCELLED") rows.push({ label: input.paymentRequirement === "NO_UPFRONT" ? "Payment due at venue" : "Outstanding", value: input.outstanding });
  const document = emailDocument({ branding: input.branding, preview: `${title} at ${input.branding.name}`,
    title, intro: `Hello ${input.customerName}, here are your booking details.`, rows,
    note: input.event === "CANCELLED" ? "Payment and refund handling, if any, is managed separately by the venue." :
      input.paymentRequirement === "NO_UPFRONT" ? "Please pay the remaining amount at the venue." : undefined,
    footer: `This message was sent by ${input.branding.name}.` });
  return { subject: `${title} · ${input.branding.name}`, ...document };
}

const subscriptionCopy: Record<string, { title: string; intro: string }> = {
  "trial.ending": { title: "Your trial is ending soon", intro: "Review your plan before the trial ends to keep venue operations running." },
  "subscription.started": { title: "Subscription started", intro: "Your venue subscription is active." },
  "payment.failed": { title: "Subscription payment needs attention", intro: "We could not confirm your latest subscription payment. Review Billing before the grace period ends." },
  "plan.upgraded": { title: "Plan upgraded", intro: "Your upgraded plan and entitlements are now active." },
  "plan.downgraded": { title: "Plan changed", intro: "Your scheduled plan change is now active. Existing venue records remain available." },
  "plan.change_scheduled": { title: "Plan change scheduled", intro: "Your requested plan or billing-cycle change will take effect at renewal." },
  "subscription.renewed": { title: "Subscription renewed", intro: "Your subscription renewal was confirmed." },
  "cancellation.scheduled": { title: "Cancellation scheduled", intro: "Your subscription remains active until the current period ends." },
  "cancellation.reversed": { title: "Subscription renewal resumed", intro: "Your subscription will renew at the end of the current period." },
};

export function subscriptionEmailTemplate(input: { type: string; venueName: string; planName: string;
  status: string; periodEnd: string; trialEnd?: string | null }): EmailTemplate {
  const copy = subscriptionCopy[input.type] ?? { title: "Subscription update", intro: "Your venue subscription has an update." };
  const end = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(input.type === "trial.ending" ? input.trialEnd ?? input.periodEnd : input.periodEnd));
  const rows = [{ label: "Venue", value: input.venueName }, { label: "Plan", value: input.planName },
    { label: "Status", value: input.status },
    { label: input.type === "trial.ending" ? "Trial ends" : "Current period ends", value: end }];
  const document = emailDocument({ branding: { name: platformBrand.name, accent: platformBrand.accent },
    preview: copy.title, title: copy.title, intro: copy.intro, rows,
    note: "Sign in and open Settings → Billing to review your plan and usage.", footer: `Sent by ${platformBrand.name}.` });
  return { subject: `${platformBrand.name}: ${copy.title}`, ...document };
}

export function scheduledReportEmailTemplate(input: { venueName: string; reportName: string; period: string;
  timezone?: string; rows: { label: string; value: string }[] }): EmailTemplate {
  const title = input.reportName;
  const document = emailDocument({ branding: { name: input.venueName }, preview: `${title} · ${input.period}`,
    title, intro: `Scheduled venue report for ${input.period}${input.timezone ? ` (${input.timezone})` : ""}.`,
    rows: input.rows, footer: `Figures reflect ${platformBrand.name} records for the stated period.` });
  return { subject: `${title} · ${input.period}`, ...document };
}

export function testEmailTemplate(input: { venueName: string; recipientName: string }): EmailTemplate {
  const document = emailDocument({ branding: { name: platformBrand.name, accent: platformBrand.accent },
    preview: "Email delivery test", title: "Email delivery is connected",
    intro: `Hello ${input.recipientName}, this test confirms that ${input.venueName} can send transactional email through the configured provider.`,
    note: "No customer message or booking was created.", footer: `Sent by ${platformBrand.name}.` });
  return { subject: `${platformBrand.name} email test`, ...document };
}

/** URLs must be validated by the server delivery boundary before rendering. */
export function accountEmailTemplate(input: { kind: "verification" | "password reset" | "invitation";
  url: string; venueName?: string }): EmailTemplate {
  const copy = input.kind === "verification"
    ? { title: "Verify your email", intro: "Confirm your email address to finish setting up your account.", action: "Verify email" }
    : input.kind === "password reset"
      ? { title: "Reset your password", intro: "Use this link to choose a new password for your account.", action: "Reset password" }
      : { title: "You're invited to join a venue", intro: `You've been invited to join ${input.venueName ?? "a venue"}. Sign in with this email address to accept.`, action: "View invitation" };
  const document = emailDocument({ branding: { name: platformBrand.name }, preview: copy.title,
    title: copy.title, intro: copy.intro, action: { label: copy.action, url: input.url },
    note: input.kind === "invitation" ? "This invitation expires after seven days. Only the invited email can accept it."
      : "If you did not request this email, you can ignore it. Keep this link private.",
    footer: `Sent by ${platformBrand.name}.` });
  return { subject: `${platformBrand.name}: ${copy.title}`, ...document };
}
export function authEmailTemplate(input: { kind: "verification" | "password reset"; url: string }): EmailTemplate {
  const title = input.kind === "verification" ? "Verify your email" : "Reset your password";
  const document = emailDocument({ branding: { name: platformBrand.name, accent: platformBrand.accent },
    preview: title, title, intro: input.kind === "verification" ?
      "Confirm your email address to finish setting up your account." : "Use the secure link below to choose a new password.",
    action: { label: title, url: input.url },
    note: "This link is private and expires. If you did not request this message, you can ignore it.",
    footer: `Sent by ${platformBrand.name}.` });
  return { subject: `${platformBrand.name}: ${title}`, ...document };
}
