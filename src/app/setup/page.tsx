import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/authorization";
import { membershipsFor } from "@/lib/organization-service";
import { BrandLogo } from "@/components/brand-logo";
import { OnboardingProgress } from "@/components/onboarding-progress";
import { OrganizationSetupForm } from "@/components/organization-setup-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up organization" };
export default async function SetupPage() {
  const session = await requireUser();
  if ((await membershipsFor(getDb(), session.user.id)).length) redirect("/dashboard");
  return <main className="setup-page" id="main-content"><div className="setup-card">
    <BrandLogo />
    <OnboardingProgress activeStep={3} />
    <p className="eyebrow">FINAL STEP</p><h1>Name your business</h1>
    <p>Just two details to get your workspace ready. You can add branches and spaces later.</p>
    <OrganizationSetupForm />
  </div></main>;
}


