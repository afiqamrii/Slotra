"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
export function CopyReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="public-secondary" onClick={async () => {
    try { await navigator.clipboard.writeText(reference); setCopied(true); }
    catch { setCopied(false); }
  }}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy reference"}</button>;
}
