import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";
import { getDevelopmentAuthReadinessIssue } from "@/lib/auth";
export const metadata: Metadata = { title: "Sign in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; verified?: string; reset?: string }> }) {
  const query = await searchParams;
  const issue = await getDevelopmentAuthReadinessIssue();
  return <><AuthPage mode="login" nextPath={query.next} configured={!issue} configurationIssue={issue ?? undefined} />{(query.verified || query.reset) && <p className="auth-floating-notice">{query.verified ? "Email verified. You can sign in." : "Password updated. Sign in again."}</p>}</>;
}


