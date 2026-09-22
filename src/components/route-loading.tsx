export function RouteLoading({ workspace = false }: { workspace?: boolean }) {
  if (!workspace) {
    return <main className="route-loading-screen" id="main-content" aria-busy="true" aria-live="polite">
      <div className="route-loading-card">
        <span className="route-loading-spinner" aria-hidden="true" />
        <strong>Loading your workspace</strong>
        <span>Just a moment…</span>
      </div>
    </main>;
  }

  return <div className="workspace-loading" aria-busy="true" aria-live="polite">
    <div className="workspace-loading-heading">
      <span className="loading-skeleton loading-skeleton-eyebrow" />
      <span className="loading-skeleton loading-skeleton-title" />
      <span className="loading-skeleton loading-skeleton-copy" />
    </div>
    <div className="workspace-loading-grid">
      {Array.from({ length: 4 }, (_, index) => <span className="loading-skeleton loading-skeleton-stat" key={index} />)}
    </div>
    <div className="workspace-loading-panels">
      <span className="loading-skeleton loading-skeleton-panel" />
      <span className="loading-skeleton loading-skeleton-panel" />
    </div>
    <p><span className="route-loading-spinner" aria-hidden="true" /> Loading page…</p>
  </div>;
}
