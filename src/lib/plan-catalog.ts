import type { StandardPlan } from "@/lib/plan-entitlements";

type PlanPreview = {
  code: StandardPlan;
  name: string;
  price: string;
  description: string;
  includes: string;
  features: readonly string[];
  featured: boolean;
};

// Presentation copy only. Payment permissions come from plan-entitlements, never this catalog.
export const planCatalog: Readonly<Record<StandardPlan, PlanPreview>> = {
  STARTER: {
    code: "STARTER",
    name: "Starter",
    price: "79",
    description: "Run your bookings.",
    includes: "Core essentials",
    features: ["200 bookings/month", "1 branch · 10 courts & spaces", "1 owner · 1 staff", "Online booking page", "Pay at venue / manual payment"],
    featured: false,
  },
  PROFESSIONAL: {
    code: "PROFESSIONAL",
    name: "Professional",
    price: "129",
    description: "Understand your business.",
    includes: "Everything in Starter, plus",
    features: ["1,000 bookings/month", "20 courts & spaces · 3 staff", "Online payments & deposits", "Professional analytics & utilisation", "Scheduled business reports"],
    featured: true,
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    price: "179",
    description: "Automate and grow.",
    includes: "Everything in Professional, plus",
    features: ["3,000 bookings/month", "Memberships & packages", "Peak/off-peak pricing", "WhatsApp reminders", "Automations & waitlist"],
    featured: false,
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    price: "279",
    description: "Scale your operation.",
    includes: "Everything in Business, plus",
    features: ["10,000 bookings/month", "Multi-branch management", "Custom domain", "Advanced permissions", "API & webhooks"],
    featured: false,
  },
};

export const planPreviews = Object.values(planCatalog);
