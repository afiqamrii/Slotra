import { planDefinitions, type StandardPlan } from "@/lib/plan-entitlements";

type PlanPreview = {
  code: StandardPlan;
  name: string;
  price: string;
  description: string;
  includes: string;
  features: readonly string[];
  featured: boolean;
};

// Presentation copy supplements the central commercial definition.
export const planCatalog: Readonly<Record<StandardPlan, PlanPreview>> = {
  STARTER: {
    code: "STARTER",
    name: "Starter",
    price: String(planDefinitions.STARTER.monthlyMinor / 100),
    description: "Run your bookings.",
    includes: "Core essentials",
    features: ["200 bookings/month", "1 branch · 10 courts & spaces", "1 owner · 1 staff", "Online booking page", "Pay at venue / manual payment"],
    featured: planDefinitions.STARTER.recommended,
  },
  PROFESSIONAL: {
    code: "PROFESSIONAL",
    name: "Professional",
    price: String(planDefinitions.PROFESSIONAL.monthlyMinor / 100),
    description: "Understand your business.",
    includes: "Everything in Starter, plus",
    features: ["1,000 bookings/month", "20 courts & spaces · 3 staff", "Online payments & deposits · live integration planned", "Professional analytics & utilisation", "Scheduled reports · email & scheduler required"],
    featured: planDefinitions.PROFESSIONAL.recommended,
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    price: String(planDefinitions.BUSINESS.monthlyMinor / 100),
    description: "Automate and grow.",
    includes: "Everything in Professional, plus",
    features: ["3,000 bookings/month", "Memberships & packages", "Peak/off-peak pricing", "WhatsApp reminders · integration planned", "Automations & waitlist"],
    featured: planDefinitions.BUSINESS.recommended,
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    price: String(planDefinitions.PRO.monthlyMinor / 100),
    description: "Scale your operation.",
    includes: "Everything in Business, plus",
    features: ["10,000 bookings/month · 5 branches", "Executive branch reports", "Custom roles & audit log",
      "Corporate accounts", "Scoped API access", "Domain verification · webhook queue"],
    featured: planDefinitions.PRO.recommended,
  },
};

export const planPreviews = Object.values(planCatalog);
