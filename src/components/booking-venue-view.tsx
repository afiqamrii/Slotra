"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Box, Check, ChevronLeft, ChevronRight, Grid2X2, Minus, Plus, RotateCcw, RotateCw, Scan } from "lucide-react";
import type { VenueSceneResource } from "@/lib/venue-scene";
import "./booking-venue-view.css";

export type BookingVenueResource = VenueSceneResource & { statusLabel: string; detail?: string };
type Props = {
  resources: BookingVenueResource[];
  selectedId?: string;
  onSelect: (id: string) => void;
  context: string;
  flatView: ReactNode;
  controls?: ReactNode;
  summary?: ReactNode;
  disabled?: boolean;
  view?: "flat" | "3d";
  onViewChange?: (view: "flat" | "3d") => void;
};
const pageSize = 12;

/** Both views operate on the caller's selection and server-provided availability. */
export function BookingVenueView({ resources, selectedId, onSelect, context, flatView, controls, summary, disabled = false, view: preferredView, onViewChange }: Props) {
  const [localView, setLocalView] = useState<"flat" | "3d">("3d");
  const view = preferredView ?? localView;
  function setView(value: "flat" | "3d") { setLocalView(value); onViewChange?.(value); }
  const [failed, setFailed] = useState(false);
  const resourceKey = resources.map(resource => resource.id).join(":");
  const selectedPage = Math.max(0, Math.floor(resources.findIndex(resource => resource.id === selectedId) / pageSize));
  const [page, setPage] = useState({ key: resourceKey, index: selectedPage });
  const regionId = useId();
  const pages = Math.ceil(resources.length / pageSize);
  const currentPage = Math.min(page.key === resourceKey ? page.index : selectedPage, Math.max(0, pages - 1));
  const visible = resources.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const show3d = view === "3d" && !failed;
  function select(id: string) {
    if (!disabled && resources.some(resource => resource.id === id)) onSelect(id);
  }
  return <div className="booking-venue-view">
    <div className="booking-venue-heading">
      <div><strong>Explore the spaces</strong><p>{context}</p></div>
      <div className="booking-venue-switch" role="group" aria-label="Venue view">
        <button type="button" aria-pressed={!show3d} aria-controls={regionId} onClick={() => setView("flat")}><Grid2X2 size={15} aria-hidden /> Flat</button>
        <button type="button" aria-pressed={show3d} aria-controls={regionId} disabled={failed} onClick={() => { setPage({ key: resourceKey, index: selectedPage }); setView("3d"); }}><Box size={16} aria-hidden /> 3D</button>
      </div>
    </div>
    {failed && <p className="booking-venue-notice" role="status">3D is unavailable in this browser. You can book using the flat view.</p>}
    <div id={regionId}>
      {show3d ? <>
        {controls}
        <p className="booking-venue-caption">Illustrative layout · actual spaces and names</p>
        {visible.length ? <VenueCanvas resources={visible} selectedId={selectedId} onSelect={select} onFailure={() => { setFailed(true); setView("flat"); }} disabled={disabled} /> : <p className="booking-venue-notice">No spaces to show for this choice.</p>}
        <div className="booking-venue-resources" role="group" aria-label="Choose a court or space">
          {visible.map(resource => <button type="button" key={resource.id} disabled={disabled} aria-pressed={selectedId === resource.id}
            className={`booking-venue-resource${selectedId === resource.id ? " selected" : ""}`} onClick={() => select(resource.id)}>
            <span className="booking-venue-resource-name">{resource.name}{selectedId === resource.id && <Check size={15} aria-hidden />}</span>
            <span className="booking-venue-resource-status"><i aria-hidden data-availability={resource.available === null ? "unknown" : resource.available ? "available" : "unavailable"} />{resource.statusLabel}</span>
            {resource.detail && <small>{resource.detail}</small>}
          </button>)}
        </div>
        {pages > 1 && <nav className="booking-venue-pagination" aria-label="3D spaces pages">
          <button type="button" aria-label="Previous 3D spaces" disabled={disabled || currentPage === 0} onClick={() => setPage({ key: resourceKey, index: currentPage - 1 })}><ChevronLeft size={17} /></button>
          <span>Spaces {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, resources.length)} of {resources.length}</span>
          <button type="button" aria-label="Next 3D spaces" disabled={disabled || currentPage + 1 >= pages} onClick={() => setPage({ key: resourceKey, index: currentPage + 1 })}><ChevronRight size={17} /></button>
        </nav>}
        {summary}
      </> : flatView}
    </div>
  </div>;
}

type Scene = ReturnType<typeof import("@/lib/venue-scene").createVenueScene>;
function VenueCanvas({ resources, selectedId, onSelect, onFailure, disabled }: {
  resources: VenueSceneResource[]; selectedId?: string; onSelect: (id: string) => void; onFailure: () => void; disabled: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const latest = useRef({ resources, selectedId, onSelect, onFailure, disabled });
  const sceneState = JSON.stringify([resources.map(({ id, name, sport, available }) => [id, name, sport, available]), selectedId]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    latest.current = { resources, selectedId, onSelect, onFailure, disabled };
  }, [resources, selectedId, onSelect, onFailure, disabled]);
  useEffect(() => {
    scene.current?.updateResources(latest.current.resources, latest.current.selectedId);
  }, [sceneState]);
  useEffect(() => {
    let disposed = false;
    const element = container.current;
    if (!element) return;
    // Three.js is a separate chunk; flat mode never needs to wait for it.
    void import("@/lib/venue-scene").then(({ createVenueScene }) => {
      if (disposed) return;
      scene.current = createVenueScene(element, {
        resources: latest.current.resources,
        onSelect: id => { if (!latest.current.disabled) latest.current.onSelect(id); },
        onError: () => { if (!disposed) latest.current.onFailure(); },
      });
      scene.current.updateResources(latest.current.resources, latest.current.selectedId);
      scene.current.setActive(!document.hidden);
      setReady(true);
    }).catch(() => { if (!disposed) latest.current.onFailure(); });
    const visibility = () => scene.current?.setActive(!document.hidden);
    const hide = () => scene.current?.setActive(false);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  return <div className="booking-venue-scene">
    <div ref={container} className="booking-venue-canvas" role="img" aria-label="Interactive illustrative venue. Choose spaces using the buttons below, or tap a space in the scene." />
    {!ready && <p className="booking-venue-loading" role="status">Preparing the 3D venue…</p>}
    <div className="booking-venue-camera">
      <span>Tap a space · use arrows to explore</span>
      <div role="group" aria-label="3D camera controls">
        <button type="button" disabled={!ready} aria-label="Rotate venue left" onClick={() => scene.current?.rotate(-1)}><RotateCcw size={17} /></button>
        <button type="button" disabled={!ready} aria-label="Rotate venue right" onClick={() => scene.current?.rotate(1)}><RotateCw size={17} /></button>
        <button type="button" disabled={!ready} aria-label="Zoom out" onClick={() => scene.current?.zoom(-1)}><Minus size={17} /></button>
        <button type="button" disabled={!ready} aria-label="Zoom in" onClick={() => scene.current?.zoom(1)}><Plus size={17} /></button>
        <button type="button" disabled={!ready} aria-label="Reset venue view" onClick={() => scene.current?.resetView()}><Scan size={17} /></button>
      </div>
    </div>
  </div>;
}
