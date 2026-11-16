"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search, X } from "lucide-react";
import { ModalDialog } from "@/components/modal-dialog";
import { filterWorkspaceCommands, workspaceCommands } from "@/lib/workspace-commands";
import "@/app/workspace-tools.css";

export function WorkspaceCommandMenu({ allowedHrefs, canCreateBooking, teamVisible, branchId }: {
  allowedHrefs: readonly string[]; canCreateBooking: boolean; teamVisible: boolean; branchId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = filterWorkspaceCommands(workspaceCommands(allowedHrefs, canCreateBooking, teamVisible, branchId), query, allowedHrefs.includes("/bookings"));
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  function show() { setQuery(""); setActive(0); setOpen(true); }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector("dialog[open]") && !open) return;
        event.preventDefault(); setQuery(""); setActive(0); setOpen(value => !value);
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`workspace-command-${activeIndex}`)?.scrollIntoView({ block: "nearest" }); }, [activeIndex, open, query]);
  function navigate(index: number) { const result = results[index]; if (result) { setOpen(false); router.push(result.href); } }
  return <>
    <button type="button" className="workspace-search-trigger" onClick={show} aria-label="Quick navigation and booking search" aria-keyshortcuts="Control+k Meta+k"><Search size={17} aria-hidden /><span>Quick find</span><kbd>Ctrl K</kbd></button>
    {open && <ModalDialog label="Quick find" onClose={() => setOpen(false)}><div className="workspace-command-menu">
      <div className="command-search"><Search size={20} aria-hidden /><input autoFocus role="combobox" aria-label="Search pages or bookings" aria-expanded="true" aria-controls="workspace-command-results" aria-autocomplete="list" aria-activedescendant={results.length ? `workspace-command-${activeIndex}` : undefined}
        placeholder="Where would you like to go?" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(value => results.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); }
          if (event.key === "Enter") { event.preventDefault(); navigate(activeIndex); }
        }} /><button type="button" className="command-close" aria-label="Close quick find" onClick={() => setOpen(false)}><X size={19} aria-hidden /></button></div>
      <div className="command-results" role="listbox" id="workspace-command-results" aria-label="Matching destinations">
        {results.map((item, index) => <button type="button" role="option" aria-selected={index === activeIndex} tabIndex={-1} id={`workspace-command-${index}`} key={item.href} onClick={() => navigate(index)} onMouseEnter={() => setActive(index)}><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowUpRight size={17} aria-hidden /></button>)}
      </div>
      {!results.length && <p className="command-empty" role="status">No matching pages. Try “calendar” or “settings”.</p>}
      <p className="command-hint"><span><kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></p>
    </div></ModalDialog>}
  </>;
}
