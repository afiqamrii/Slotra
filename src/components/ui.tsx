import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

type HeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: string;
};

export function PageHeader({ eyebrow, title, description, action }: HeaderProps) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action ? (
        <button className="button button-primary page-header-action" disabled title={`${action} is not available yet`} type="button">
          <Plus aria-hidden="true" size={18} /> {action}
        </button>
      ) : null}
    </header>
  );
}

export function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {href && linkLabel ? <Link className="text-link" href={href}>{linkLabel}<ArrowRight aria-hidden="true" size={15} /></Link> : null}
    </div>
  );
}

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" | "info" }) {
  return <span className={`status-badge status-${tone}`}><span aria-hidden="true" className="status-dot" />{label}</span>;
}

export function StatCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: LucideIcon }) {
  return (
    <article className="stat-card">
      <div className="stat-card-top"><span>{label}</span><Icon aria-hidden="true" size={19} strokeWidth={1.8} /></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: string }) {
  return (
    <section className="empty-state">
      <div aria-hidden="true" className="empty-state-icon"><Icon size={29} strokeWidth={1.6} /></div>
      <p className="eyebrow">READY FOR WHAT’S NEXT</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <button className="button button-primary" disabled title={`${action} is not available yet`} type="button">{action}</button> : null}
      <small>Visual preview only · This feature is not connected yet.</small>
    </section>
  );
}
