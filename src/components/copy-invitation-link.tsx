"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyInvitationLink({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copyLink() {
    const url = new URL("/invitations/" + encodeURIComponent(token), window.location.origin);
    try {
      await navigator.clipboard.writeText(url.toString());
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return <>
    <button className="button button-secondary invite-copy-button" onClick={copyLink} type="button">
      {status === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
      {status === "copied" ? "Copied" : "Copy link"}
    </button>
    <span aria-live="polite" className="invite-copy-feedback">
      {status === "error" ? "Couldn’t copy automatically. Open the invitation link and copy its address." : ""}
    </span>
  </>;
}
