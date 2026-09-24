import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BellRing, Clock3, Mail, UserRoundCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/authorization";
import { listAutomationExecutions, listAutomationWorkflows } from "@/lib/business-automations";
import { emailReady } from "@/lib/email-delivery";
import { hasOrganizationFeature } from "@/lib/organization-entitlements";
import { hasPermission } from "@/lib/permissions";
import { configuredWhatsAppProvider, whatsappConnectionState } from "@/lib/whatsapp-provider";
import { createAutomationAction, simulateWhatsAppAction, toggleAutomationAction } from "./actions";

export const metadata: Metadata = { title: "Automations" };

const templates = [
  { id: "REMINDER_24_HOURS", title: "The day before", detail: "Email the customer 24 hours before their booking.", icon: BellRing },
  { id: "REMINDER_2_HOURS", title: "Two hours before", detail: "A short email reminder for a booking happening soon.", icon: Clock3 },
  { id: "INACTIVE_30_DAYS", title: "Inactive for 30 days", detail: "Tag former players who have not booked again in 30 days.", icon: UserRoundCheck },
] as const;

function statusLabel(status: string, action: string) {
  if (status === "DEV_PREVIEW") return "Development preview · not sent";
  if (status === "SENT") return action === "TAG_INACTIVE" ? "Customer tagged" : "Sent";
  if (status === "FAILED") return "Could not send";
  if (status === "SKIPPED") return "Skipped";
  return "Pending";
}

export default async function AutomationsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; saved?: string; simulation?: string }>;
}) {
  const { organization, member, session } = await requirePermission("organization:view");
  const db = getDb(), organizationId = organization.organizationId;
  if (!await hasOrganizationFeature(db, organizationId, "AUTOMATIONS")) redirect("/grow");
  const [params, workflows, executions] = await Promise.all([
    searchParams,
    listAutomationWorkflows(db, session.user.id, organizationId),
    listAutomationExecutions(db, session.user.id, organizationId),
  ]);
  const canEdit = hasPermission(member.role, "organization:update");
  const runnerReady = Boolean(process.env.BUSINESS_AUTOMATION_RUNNER_SECRET &&
    process.env.BUSINESS_AUTOMATION_RUNNER_SECRET.length >= 32);
  const whatsApp = whatsappConnectionState();
  const simulation = process.env.NODE_ENV !== "production" &&
    ["DEV_SIMULATED_SUCCESS", "DEV_SIMULATED_FAILURE", "DEV_SIMULATED_DELAYED"].includes(params.simulation ?? "")
    ? params.simulation : null;
  return <div className="foundation-page grow-page">
    <Link className="text-link" href="/grow">← Grow</Link>
    <p className="eyebrow">GROW / AUTOMATIONS</p><h1>Automations</h1>
    <p className="foundation-lead">Choose a ready-made reminder or keep your customer list tidy. No complicated workflow builder.</p>
    {params.error && <p className="pro-error" role="alert">{params.error}</p>}
    {params.saved && <p className="pro-success" role="status">Automation saved.</p>}
    {simulation && <p className="pro-success" role="status">
      Development simulation: {simulation.replaceAll("_", " ").toLowerCase()}. No WhatsApp message was sent.
    </p>}
    <section className="foundation-card grow-form-card">
      <h2>Start with a template</h2>
      <p className="grow-form-help">Reminders use the customer email on a confirmed booking. If no email is available, that reminder is skipped.</p>
      <p className="grow-form-help">Booking confirmations, changes, and cancellations already use the booking notification service; these templates add scheduled follow-ups.</p>
      <div className="grow-card-grid">
        {templates.map(({ id, title, detail, icon: Icon }) => {
          const present = workflows.find(row => row.trigger === (id === "INACTIVE_30_DAYS" ? "CUSTOMER_INACTIVE" : "BOOKING_REMINDER") &&
            (id === "INACTIVE_30_DAYS" ? row.config.inactiveDays === 30 :
              row.config.leadMinutes === (id === "REMINDER_24_HOURS" ? 1440 : 120)));
          return <article className="foundation-card grow-card" key={id}>
            <Icon size={22} aria-hidden="true" /><strong>{title}</strong><span>{detail}</span>
            {present ? <small>{present.isActive ? "Enabled" : "Paused"}</small> : canEdit ?
              <form action={createAutomationAction}><input type="hidden" name="template" value={id} />
                <button className="button button-secondary" type="submit">Use template</button></form> :
              <small>Ask an owner to set this up</small>}
          </article>;
        })}
      </div>
    </section>
    <section className="foundation-card grow-list-card">
      <h2>Your automations</h2>
      {workflows.length ? <div className="grow-list">{workflows.map(row =>
        <div key={row.id}><div><strong>{row.name}</strong>
          <small>{row.trigger === "BOOKING_REMINDER" ? "Customer email" : "Customer tag"} · {row.isActive ? "Enabled" : "Paused"}</small></div>
          {canEdit && <form action={toggleAutomationAction}><input type="hidden" name="workflowId" value={row.id} />
            <input type="hidden" name="active" value={row.isActive ? "false" : "true"} />
            <button className="button button-secondary" type="submit">{row.isActive ? "Pause" : "Enable"}</button></form>}</div>)}</div> :
        <p className="grow-empty">No automations yet. The 24-hour reminder is a useful first step.</p>}
    </section>
    <section className="foundation-card grow-list-card">
      <h2>Delivery &amp; recent activity</h2>
      <p className="grow-form-help"><Mail size={15} aria-hidden="true" /> Email: {emailReady() ? "provider configured" :
        process.env.NODE_ENV === "production" ? "not configured — reminders will not be sent" :
          "development preview only — no email is sent"}.</p>
      <p className="grow-form-help">Scheduled runner: {runnerReady ? "configured; external scheduling still required" :
        "not configured — templates are saved but will not run automatically"}.</p>
      <p className="grow-form-help">WhatsApp: {whatsApp.label} Opt-in records, approved templates, and a venue-owned sender are required before live delivery.</p>
      {canEdit && configuredWhatsAppProvider() && <form action={simulateWhatsAppAction}>
        <button className="button button-secondary" type="submit">Run WhatsApp test simulation</button>
        <p className="grow-form-help">Uses synthetic details only. Never contacts a real customer.</p>
      </form>}
      {executions.length ? <div className="grow-list">{executions.map(({ execution, workflowName }) =>
        <div key={execution.id}><div><strong>{workflowName}</strong>
          <small>{execution.createdAt.toLocaleString("en-MY")} · {statusLabel(execution.status,
            workflows.find(row => row.id === execution.workflowId)?.action ?? "")}</small></div>
          <span>{execution.errorSummary ?? ""}</span></div>)}</div> :
        <p className="grow-empty">No runs yet. Activity appears here after a scheduled run.</p>}
    </section>
  </div>;
}
