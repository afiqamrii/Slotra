"use client";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import "@/app/workspace-tools.css";
export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="workspace-recovery" role="alert"><RefreshCw size={30} aria-hidden /><p className="eyebrow">LET’S TRY THAT AGAIN</p><h1>This page couldn’t load</h1><p>Check your connection and try again. If this happened after saving, check the record before submitting it again.</p><div className="workspace-recovery-actions"><button type="button" className="button button-primary" onClick={reset}>Try again</button><Link className="button button-secondary" href="/dashboard">Back to Home</Link></div></section>;
}
