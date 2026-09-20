import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  LayoutGrid,
  MoveUpRight,
  UsersRound,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { brand } from "@/lib/brand";
import { planPreviews } from "@/lib/plan-catalog";

export const metadata: Metadata = { title: "A clearer way to run your venue" };

const values = [
  { icon: CalendarDays, title: "Bookings, in one place", text: "Give your team a clear view of what’s happening across every space." },
  { icon: LayoutGrid, title: "Built around your venue", text: "Courts, lanes, fields and more — one simple home for every bookable space." },
  { icon: UsersRound, title: "Made for real people", text: "Keep the everyday work easy for owners, staff and the players who visit." },
];

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-header container-wide">
        <BrandLogo />
        <nav aria-label="Main navigation" className="landing-nav">
          <a href="#product">Product</a>
          <a href="#pricing">Pricing</a>
          <Link href="/login">Sign in</Link>
        </nav>
        <Link className="button button-primary landing-header-action" href="/dashboard">Get started <ArrowRight aria-hidden="true" size={17} /></Link>
      </header>
      <main id="main-content">
        <section className="landing-hero container-wide">
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow"><span className="eyebrow-line" /> VENUE MANAGEMENT, MADE SIMPLE</p>
            <h1>A clearer way to <em>run your venue.</em></h1>
            <p className="hero-description">See today’s bookings, manage your courts and keep your team on the same page. One simple workspace for your sports venue.</p>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/dashboard">Explore the workspace <ArrowRight aria-hidden="true" size={18} /></Link>
              <Link className="button button-secondary button-large" href="/register">Set up your venue <MoveUpRight aria-hidden="true" size={17} /></Link>
            </div>
            <p className="hero-footnote">Sample dashboard visual · Set up your venue in minutes</p>
          </div>
          <div aria-label="Preview of a venue dashboard" className="hero-visual">
            <div className="hero-visual-top"><span className="hero-visual-brand"><span className="hero-visual-mark" /> Smash Arena</span><span className="hero-visual-date">TODAY’S OVERVIEW</span></div>
            <div className="hero-visual-heading"><div><small>Good morning</small><strong>Your day, at a glance.</strong></div><span className="hero-live-indicator">Sample data</span></div>
            <div className="hero-visual-stats"><div><small>Bookings today</small><strong>18</strong></div><div><small>Courts in use</small><strong>3 / 8</strong></div><div><small>Revenue today</small><strong>RM 1,420</strong></div></div>
            <div className="hero-visual-schedule"><div className="hero-visual-schedule-head"><strong>Upcoming bookings</strong><CalendarDays aria-hidden="true" size={17} /></div><div><span>10:30</span><strong>Daniel Lim</strong><small>Pickleball · Court 1</small></div><div><span>12:00</span><strong>Farah Ahmad</strong><small>Badminton · Court 3</small></div></div>
            <div className="hero-visual-corner"><Clock3 aria-hidden="true" size={18} /><span>Make room for a smoother day.</span></div>
          </div>
        </section>
        <section className="value-section" id="product"><div className="container-wide"><div className="section-intro"><p className="eyebrow">THE EVERYDAY, MADE EASIER</p><h2>Less admin. More time for your venue.</h2><p>One thoughtful workspace for the moving parts of a busy sports business.</p></div><div className="value-grid">{values.map(({ icon: Icon, title, text }) => <article className="value-card" key={title}><span className="value-icon"><Icon aria-hidden="true" size={24} strokeWidth={1.7} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
        <section className="pricing-section container-wide" id="pricing">
          <div className="section-intro">
            <p className="eyebrow">PLANS PREVIEW</p>
            <h2>Start simple. Grow at your pace.</h2>
            <p>Clear plans for venues at every stage. Billing is not available in this preview.</p>
          </div>
          <div className="pricing-grid">
            {planPreviews.map((plan) => (
              <article className={`pricing-card${plan.featured ? " pricing-card-featured" : ""}`} key={plan.name}>
                {plan.featured ? <span className="popular-label">MOST POPULAR</span> : null}
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <div className="price"><span>RM</span><strong>{plan.price}</strong><span>/ month</span></div>
                <p className="pricing-includes">{plan.includes}</p>
                <ul className="pricing-features">
                  {plan.features.map((feature) => <li key={feature}><Check aria-hidden="true" size={15} strokeWidth={2} /><span>{feature}</span></li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-cta"><div className="container-wide landing-cta-inner"><div><p className="eyebrow">A BETTER DAY STARTS HERE</p><h2>Make every booking feel easier.</h2><p>Explore the visual foundation while the full product takes shape.</p></div><Link className="button button-light button-large" href="/dashboard">Explore the workspace <ArrowRight aria-hidden="true" size={18} /></Link></div></section>
      </main>
      <footer className="landing-footer container-wide"><BrandLogo /><span>A product by {brand.company}</span><span>© {new Date().getFullYear()} {brand.name}</span></footer>
    </div>
  );
}

