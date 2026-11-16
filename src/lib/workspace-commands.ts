export type WorkspaceCommand = { label: string; description: string; href: string; keywords: string };
const destinations: WorkspaceCommand[] = [
  { label: "Home", description: "Today’s activity and venue overview", href: "/dashboard", keywords: "overview today" },
  { label: "Bookings", description: "Find and manage reservations", href: "/bookings", keywords: "reservation customer reference" },
  { label: "Calendar", description: "Plan your courts and spaces", href: "/calendar", keywords: "schedule agenda week day" },
  { label: "Customers", description: "Customer profiles and booking history", href: "/customers", keywords: "people contacts players" },
  { label: "Courts & Spaces", description: "Manage spaces, hours and pricing", href: "/courts-and-spaces", keywords: "resources facilities" },
  { label: "Payments", description: "Receipts, refunds and outstanding balances", href: "/payments", keywords: "money unpaid payment cash" },
  { label: "Reports", description: "Understand your venue’s performance", href: "/reports", keywords: "analytics revenue export" },
  { label: "Grow", description: "Memberships, promotions and automation", href: "/grow", keywords: "packages discounts waitlist" },
  { label: "Settings", description: "Configure your workspace", href: "/settings", keywords: "setup preferences integrations" },
];
export function workspaceCommands(allowed: readonly string[], canCreate: boolean, team: boolean, branchId?: string) {
  const branch = branchId ? `branchId=${encodeURIComponent(branchId)}` : "";
  return [
    ...(canCreate ? [
      { label: "New booking", description: "Reserve a time for a customer", href: `/bookings/new${branch ? `?${branch}` : ""}`, keywords: "create reserve" },
      { label: "New walk-in", description: "Book a guest arriving at the venue", href: `/bookings/new?mode=walk-in${branch ? `&${branch}` : ""}`, keywords: "create guest" },
    ] : []),
    ...(allowed.includes("/bookings") ? [{ label: "Available now", description: "See which spaces are free right now", href: `/available-now${branch ? `?${branch}` : ""}`, keywords: "live availability courts" }] : []),
    ...destinations.filter(item => allowed.includes(item.href)),
    ...(team ? [{ label: "Team", description: "Manage teammates and invitations", href: "/team", keywords: "staff members permissions" }] : []),
    { label: "Account & sessions", description: "Manage your personal account", href: "/account/security", keywords: "security sign in devices" },
  ];
}
export function filterWorkspaceCommands(commands: WorkspaceCommand[], search: string, allowBookingSearch: boolean) {
  const query = search.trim().slice(0, 100);
  const words = query.toLocaleLowerCase().split(/\s+/);
  const matches = commands.filter(item => words.every(word => `${item.label} ${item.description} ${item.keywords}`.toLocaleLowerCase().includes(word)));
  if (query && allowBookingSearch) matches.push({ label: `Search bookings for “${query}”`, description: "Search references, customer names and phone numbers", href: `/bookings?view=all&q=${encodeURIComponent(query)}`, keywords: "" });
  return matches;
}
