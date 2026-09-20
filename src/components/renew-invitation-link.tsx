"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { renewInvitationLinkAction } from "@/app/actions/team";

export function RenewInvitationLink({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");

  async function renewAndCopy() {
    setPending(true);
    setMessage("");
    if (link) {
      try {
        await navigator.clipboard.writeText(link);
        setMessage("Link copied.");
      } catch {
        setMessage("Copy the link from the field below.");
      } finally {
        setPending(false);
      }
      return;
    }
    try {
      const result = await renewInvitationLinkAction(invitationId);
      if (!result.token) {
        setMessage(result.error ?? "Could not create a new invitation link.");
        return;
      }
      const url = new URL("/invitations/" + encodeURIComponent(result.token), window.location.origin).toString();
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setMessage("New link copied. The previous link no longer works.");
      } catch {
        setMessage("New link created. Copy it from the field below. The previous link no longer works.");
      }
    } catch {
      setMessage("Could not create a new invitation link. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="pending-invite-copy">
    <button className="text-button" disabled={pending} onClick={renewAndCopy} type="button">
      {link ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
      {pending ? "Creating…" : link ? "Copy new link" : "Copy link"}
    </button>
    {message && <small aria-live="polite">{message}</small>}
    {link && <input aria-label="New invitation link" onFocus={(event) => event.currentTarget.select()} readOnly value={link} />}
  </div>;
}

