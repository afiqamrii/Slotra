import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";
import { getDevelopmentAuthReadinessIssue } from "@/lib/auth";
export const metadata: Metadata = { title: "Create account" };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const issue = (await getDevelopmentAuthReadinessIssue()) ?? (process.env.NODE_ENV === "production" ? "Registration needs a configured email provider." : null);
  return <AuthPage mode="register" nextPath={(await searchParams).next} configured={!issue} configurationIssue={issue ?? undefined} />;
}



