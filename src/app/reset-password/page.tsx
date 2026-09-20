import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";
import { getDevelopmentAuthReadinessIssue } from "@/lib/auth";
export const metadata: Metadata = { title: "New password" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const issue = (await getDevelopmentAuthReadinessIssue()) ?? (process.env.NODE_ENV === "production" ? "Password recovery needs a configured email provider." : null);
  return <AuthPage mode="reset" token={(await searchParams).token} configured={!issue} configurationIssue={issue ?? undefined} />;
}



