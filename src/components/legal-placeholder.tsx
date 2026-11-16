import Link from "next/link";
import { brand } from "@/lib/brand";
import { supportEmail } from "@/lib/support";
import { LegalLinks } from "@/components/legal-links";
export function LegalPlaceholder({ title, topics }: { title: string; topics: string }) {
  const support = supportEmail();
  return <main className="legal-page" id="main-content"><Link href="/">{brand.name}</Link><h1>{title}</h1>
    <div className="legal-review"><strong>Draft — legal review required</strong><p>{brand.company} has not published final {title.toLowerCase()} here. This page is a preparation notice and does not claim legal compliance or replace a reviewed policy.</p></div>
    <p>Before public launch, the operator must publish reviewed terms covering {topics}.</p>
    <p>Venue cancellation rules and refund policies are supplied by the venue and appear on its booking page when configured.</p>
    {support ? <p>Contact <a href={`mailto:${support}`}>{support}</a> for the current policy or questions.</p> : <p>The operator must configure a support contact before public launch.</p>}
    <LegalLinks /></main>;
}
