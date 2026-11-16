export function VenueMigrationNotice() {
  return <div className="foundation-page">
    <p className="eyebrow">SETUP REQUIRED</p>
    <h1>Venue setup needs a database update</h1>
    <p className="foundation-lead">This environment needs a database update before the workspace can open. Ask the workspace administrator to review and apply all committed database migrations for this application version.</p>
  </div>;
}

