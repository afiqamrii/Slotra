"use client";
import { useEffect } from "react";
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { void fetch("/api/monitoring/client", { method: "POST", credentials: "omit" }).catch(() => {}); }, []);
  return <html lang="en"><body><main style={{ maxWidth: 520, padding: "80px 24px", margin: "auto", fontFamily: "system-ui" }}>
    <h1>Something went wrong</h1><p>We couldn’t load this page. Please try again.</p><button onClick={reset}>Try again</button>
  </main></body></html>;
}
