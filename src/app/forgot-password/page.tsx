import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";
import { getDevelopmentAuthReadinessIssue } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset password" };
export default async function ForgotPasswordPage() {
  const issue = (await getDevelopmentAuthReadinessIssue()) ?? (process.env.NODE_ENV === "production" ? "Password recovery needs a configured email provider." : null);
  return <AuthPage mode="forgot" configured={!issue} configurationIssue={issue ?? undefined} />;
}



