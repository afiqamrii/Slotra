export function VenueMigrationNotice() {
  return <div className="foundation-page">
    <p className="eyebrow">SETUP REQUIRED</p>
    <h1>Venue setup needs a database update</h1>
    <p className="foundation-lead">The application is ready, but its Phase 3 database migration has not been applied to this environment. Ask the workspace administrator to apply migration 0003 before using venue setup or Courts &amp; Spaces.</p>
  </div>;
}

