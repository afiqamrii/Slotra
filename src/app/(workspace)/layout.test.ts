import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission, Role } from "@/lib/permissions";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), member: vi.fn(), schemaReady: vi.fn(), billing: vi.fn(), branches: vi.fn(), authorized: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/authorization", () => ({ requireOrganizationMember: mocks.member }));
vi.mock("@/lib/venue-schema", () => ({ venueSchemaReady: mocks.schemaReady }));
vi.mock("@/lib/subscription-access", () => ({ organizationBillingAccess: mocks.billing }));
vi.mock("@/lib/branch-context", () => ({ branchContext: mocks.branches }));
vi.mock("@/lib/organization-service", () => ({ authorizedMembership: mocks.authorized }));
vi.mock("@/lib/product-urls", () => ({ publicBookingUrl: (slug: string) => `https://book.example.test/${slug}` }));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/top-bar", () => ({ TopBar: () => null }));
import WorkspaceLayout from "./layout";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { VenueMigrationNotice } from "@/components/venue-migration-notice";

function findProps<T>(tree: ReactNode, type: unknown): T | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return child.props as T;
    const found = findProps<T>(child.props.children, type);
    if (found) return found;
  }
}

describe("workspace navigation authorization", () => {
  let scope: "ALL" | "SELECTED";
  let role: Role;
  let grants: Set<Permission>;
  let billing: { plan: string; features: { ADVANCED_REPORTS: boolean; MULTI_BRANCH: boolean }; writable: boolean; status: string };
  const branchId = "branch-a";
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: vi.fn() };
  const db = { select: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    scope = "SELECTED"; role = "STAFF";
    grants = new Set(["booking:view", "booking:create", "customer:view", "member:view", "payment:view"]);
    billing = { plan: "PRO", features: { ADVANCED_REPORTS: true, MULTI_BRANCH: true }, writable: true, status: "ACTIVE" };
    db.select.mockReturnValue(query);
    query.from.mockReturnValue(query); query.innerJoin.mockReturnValue(query); query.where.mockReturnValue(query);
    query.limit.mockResolvedValue([{ slug: "venue" }]);
    mocks.getDb.mockReturnValue(db);
    mocks.schemaReady.mockResolvedValue(true);
    mocks.member.mockImplementation(async () => ({ session: { user: { id: "user", name: "Team member" } },
      organization: { organizationId: "venue", name: "Venue", role }, memberships: [] }));
    mocks.billing.mockImplementation(async () => billing);
    mocks.branches.mockImplementation(async () => ({ selected: branchId, canSwitch: true,
      branches: [{ id: branchId, name: "First", isActive: true }, { id: "branch-b", name: "Second", isActive: true }] }));
    mocks.authorized.mockImplementation(async (_db: unknown, _user: string, _organization: string,
      permission: Permission, requestedBranch?: string) => {
      if (permission !== "organization:view" && !grants.has(permission)) return null;
      if (scope === "SELECTED" && permission !== "organization:view" && requestedBranch !== branchId) return null;
      return { organizationId: "venue", role, memberId: "member", branchScope: scope };
    });
  });

  it("keeps tenant-wide customer and team links out of selected-branch staff navigation", async () => {
    const tree = await WorkspaceLayout({ children: "Page" });
    const sidebar = findProps<Parameters<typeof AppSidebar>[0]>(tree, AppSidebar);
    const topBar = findProps<Parameters<typeof TopBar>[0]>(tree, TopBar);
    expect(sidebar?.allowedHrefs).toEqual(["/dashboard", "/bookings", "/calendar", "/payments", "/grow", "/settings"]);
    expect(sidebar?.teamVisible).toBe(false);
    expect(sidebar?.publicBookingHref).toBe("https://book.example.test/venue");
    expect(sidebar?.planHref).toBe("/settings/plan");
    expect(topBar?.canCreateBooking).toBe(true);
    expect(topBar?.branchSelection.canViewAll).toBe(false);
    expect(mocks.authorized).toHaveBeenCalledWith(db, "user", "venue", "customer:view");
    expect(mocks.authorized).toHaveBeenCalledWith(db, "user", "venue", "member:view");
    expect(mocks.authorized).toHaveBeenCalledWith(db, "user", "venue", "payment:view", branchId);
  });

  it("uses effective custom grants even when the stored base role is Admin", async () => {
    scope = "ALL"; role = "ADMIN"; grants = new Set(["booking:view"]);
    const tree = await WorkspaceLayout({ children: "Page" });
    const sidebar = findProps<Parameters<typeof AppSidebar>[0]>(tree, AppSidebar);
    const topBar = findProps<Parameters<typeof TopBar>[0]>(tree, TopBar);
    expect(sidebar?.allowedHrefs).toEqual(["/dashboard", "/bookings", "/calendar", "/grow", "/settings"]);
    expect(sidebar?.teamVisible).toBe(false);
    expect(topBar?.canCreateBooking).toBe(false);
  });

  it("retains every granted area for an organization-wide owner", async () => {
    scope = "ALL"; role = "OWNER";
    grants = new Set(["booking:view", "booking:create", "customer:view", "resource:view", "payment:view",
      "report:view_financial", "member:view", "billing:view"]);
    const tree = await WorkspaceLayout({ children: "Page" });
    const sidebar = findProps<Parameters<typeof AppSidebar>[0]>(tree, AppSidebar);
    expect(sidebar?.allowedHrefs).toEqual(["/dashboard", "/bookings", "/calendar", "/customers", "/courts-and-spaces",
      "/payments", "/reports", "/grow", "/settings"]);
    expect(sidebar?.teamVisible).toBe(true);
    expect(findProps<Parameters<typeof TopBar>[0]>(tree, TopBar)?.branchSelection.canViewAll).toBe(true);
  });

  it("does not offer tenant-wide basic reports to branch-only finance staff", async () => {
    grants = new Set(["report:view_financial"]); billing.features.ADVANCED_REPORTS = false;
    const tree = await WorkspaceLayout({ children: "Page" });
    expect(findProps<Parameters<typeof AppSidebar>[0]>(tree, AppSidebar)?.allowedHrefs).not.toContain("/reports");
    expect(mocks.authorized).toHaveBeenCalledWith(db, "user", "venue", "report:view_financial", undefined);
  });

  it("offers advanced reports when the current branch has the financial grant", async () => {
    grants = new Set(["report:view_financial"]);
    const tree = await WorkspaceLayout({ children: "Page" });
    expect(findProps<Parameters<typeof AppSidebar>[0]>(tree, AppSidebar)?.allowedHrefs).toContain("/reports");
    expect(mocks.authorized).toHaveBeenCalledWith(db, "user", "venue", "report:view_financial", branchId);
  });

  it("stops before newer-schema queries when migrations are incomplete", async () => {
    mocks.schemaReady.mockResolvedValue(false);
    const tree = await WorkspaceLayout({ children: "Page" });
    expect(findProps(tree, VenueMigrationNotice)).toBeDefined();
    expect(mocks.billing).not.toHaveBeenCalled(); expect(mocks.branches).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled(); expect(mocks.authorized).not.toHaveBeenCalled();
    expect(findProps(tree, AppSidebar)).toBeUndefined();
  });
});
