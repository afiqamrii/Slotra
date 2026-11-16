import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizationMember } from "@/lib/authorization";
import { emailReady } from "@/lib/email-delivery";
import { sendTestEmailAction } from "./actions";

export default async function NotificationSettingsPage({ searchParams }: {
  searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { organization } = await requireOrganizationMember();
  if (!["OWNER", "ADMIN"].includes(organization.role)) notFound();
  const params = await searchParams, ready = emailReady();
  return <div className="foundation-page"><Link className="text-link" href="/settings">← Settings</Link>
    <p className="eyebrow">SETTINGS / EMAIL</p><h1>Email delivery</h1>
    <p className="foundation-lead">Check the transactional sender used for booking, subscription and scheduled-report messages.</p>
    {params.sent && <p className="billing-success" role="status">Test email accepted by the provider. Check your account email inbox.</p>}
    {params.error && <p className="billing-alert" role="alert">The test email was not sent. Check provider and sender-domain configuration.</p>}
    <section className="foundation-card"><h2>{ready ? "Resend is configured" : "Email is not configured"}</h2>
      <p>{ready ? "Send a minimal test to your own signed-in account email. Customer data is not included." :
        "Add a Resend API key and verified sender values to the server environment before sending email."}</p>
      {ready ? <form action={sendTestEmailAction}><button className="button button-primary">Send test email</button></form> :
        <p className="billing-note">No message will be marked as delivered while provider configuration is missing.</p>}
    </section></div>;
}
