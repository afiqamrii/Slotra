import Link from "next/link";
import { MapPinOff } from "lucide-react";
import "./workspace-tools.css";
export default function NotFound() {
  return <main id="main-content" className="workspace-recovery"><MapPinOff size={32} aria-hidden /><p className="eyebrow">PAGE UNAVAILABLE</p><h1>We couldn’t find that page</h1><p>The link may have changed, or this page may not be available to your account.</p><div className="workspace-recovery-actions"><Link className="button button-primary" href="/dashboard">Go to workspace</Link><Link className="button button-secondary" href="/">Back to home</Link></div></main>;
}
