import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/db/schema";

const fixture = vi.hoisted(() => ({ select: vi.fn(), canPrice: true, hours: [] as object[] }));
const branch = { id: "branch-a", name: "Main venue", addressLine1: "12 Court Road", addressLine2: "", city: "Kuala Lumpur",
  state: "Wilayah Persekutuan", postcode: "50000", country: "MY", timezone: "Asia/Kuala_Lumpur", isActive: true };
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/db/client", () => ({ getDb: () => ({ select: fixture.select }) }));
vi.mock("@/lib/authorization", () => ({ requirePermission: async () => ({
  organization: { organizationId: "organization-a" }, session: { user: { id: "owner-a" } },
}) }));
vi.mock("@/lib/organization-entitlements", () => ({ hasOrganizationFeature: async () => false }));
vi.mock("@/lib/organization-service", () => ({ authorizedMembership: async (_db: unknown, _actor: string, _org: string, permission: string) =>
  permission === "branch:manage" || fixture.canPrice ? { role: "OWNER", branchScope: "ALL" } : null,
}));
vi.mock("@/lib/branch-context", () => ({ branchContext: async () => ({ branches: [branch] }) }));
vi.mock("@/app/actions/venue", () => ({
  createBranchAction: vi.fn(), updateBranchSetupAction: vi.fn(), saveBranchAction: vi.fn(),
  saveResourceAction: vi.fn(), resourceStatusAction: vi.fn(),
}));

import BranchPage from "@/app/(workspace)/settings/branch/page";

beforeEach(() => {
  fixture.canPrice = true;
  fixture.hours = [{ dayOfWeek: 1, startMinute: 480, endMinute: 1440 }];
  fixture.select.mockImplementation(() => {
    let table: unknown;
    const rows = () => table === schema.branches ? [branch] : table === schema.organizations ? [{ timezone: branch.timezone }] :
      table === schema.organizationSports ? [{ id: "sport-a", name: "Badminton" }] :
      table === schema.basePrices ? [{ sportTypeId: "sport-a", amountMinor: 2500 }] : fixture.hours;
    const query = {
      from: (value: unknown) => { table = value; return query; },
      innerJoin: () => query, where: () => query, orderBy: () => query,
      limit: async () => rows(),
      then: (resolve: (value: object[]) => unknown) => Promise.resolve(rows()).then(resolve),
    };
    return query;
  });
});

describe("single-branch settings maintenance", () => {
  it("shows opening hours and base price editing on Starter without branch creation", async () => {
    const html = renderToStaticMarkup(await BranchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Hours &amp; pricing");
    expect(html).toContain("Opening hours");
    expect(html).toContain("Sports and base prices");
    expect(html).toContain('value="25.00"');
    expect(html).toContain("Save branch");
    expect(html).not.toContain("Add branch");
  });

  it("keeps prices locked for a branch manager without the pricing grant", async () => {
    fixture.canPrice = false;
    const html = renderToStaticMarkup(await BranchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("base prices require pricing permission");
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain("Save branch");
  });

  it("preserves an entirely closed schedule when reopening the editor", async () => {
    fixture.hours = [];
    const html = renderToStaticMarkup(await BranchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('type="checkbox" checked=""/>Closed');
    expect(html).toContain('type="time" disabled=""');
  });
});
