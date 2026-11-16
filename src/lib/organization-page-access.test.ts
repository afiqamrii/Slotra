import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  branchLimited: true,
  permissionGranted: true,
  exportAllowed: true,
  financialAllowed: true,
  select: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => ({ value: "organization-a" }) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error("redirect:" + path); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("@/db/client", () => ({ getDb: () => ({ select: fixture.select }) }));
vi.mock("@/lib/auth", () => ({
  isAuthConfigured: () => true,
  getAuth: async () => ({ api: { getSession: async () => ({ user: { id: "user-a" } }) } }),
}));
vi.mock("@/lib/organization-service", () => ({
  membershipsFor: async () => [{ organizationId: "organization-a", role: "ADMIN" }],
  authorizedMembership: fixture.authorize,
}));
vi.mock("@/lib/branch-context", () => ({ branchContext: async () => ({ selected: "branch-a" }) }));

import { requireOrganizationWidePermission, requirePermission } from "@/lib/authorization";
import CustomersPage from "@/app/(workspace)/customers/page";
import { GET as exportCsv } from "@/app/api/exports/[dataset]/route";

beforeEach(() => {
  fixture.branchLimited = true;
  fixture.permissionGranted = true;
  fixture.exportAllowed = true;
  fixture.financialAllowed = true;
  fixture.select.mockReset();
  fixture.authorize.mockReset().mockImplementation(async (_db, _user, _org, permission, branchId) =>
    fixture.permissionGranted && (permission !== "report:export" || fixture.exportAllowed) &&
      (permission !== "report:view_financial" || fixture.financialAllowed) &&
      (!fixture.branchLimited || branchId === "branch-a")
      ? { organizationId: "organization-a", role: "ADMIN", branchScope: fixture.branchLimited ? "SELECTED" : "ALL" }
      : null);
});

describe("organization-wide page and export authorization", () => {
  it("keeps a valid branch permission separate from organization-wide access", async () => {
    await expect(requirePermission("customer:view")).resolves.toMatchObject({ member: { branchScope: "SELECTED" } });
    await expect(requireOrganizationWidePermission("customer:view")).rejects.toThrow("not-found");
    expect(fixture.authorize.mock.calls.at(-1)).toHaveLength(4);
  });

  it("denies branch-limited staff before the customer page reads tenant contacts", async () => {
    await expect(CustomersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
    expect(fixture.select).not.toHaveBeenCalled();
  });

  it.each(["customers", "bookings", "payments"])("denies branch-limited staff before the %s CSV query", async dataset => {
    await expect(exportCsv(new Request(`https://app.example.test/api/exports/${dataset}`),
      { params: Promise.resolve({ dataset }) })).rejects.toThrow("not-found");
    expect(fixture.select).not.toHaveBeenCalled();
  });

  it("authorizes all-branch staff through effective permissions", async () => {
    fixture.branchLimited = false;
    await expect(requireOrganizationWidePermission("customer:view"))
      .resolves.toMatchObject({ member: { branchScope: "ALL" } });
    fixture.permissionGranted = false;
    await expect(requireOrganizationWidePermission("member:view")).rejects.toThrow("not-found");
  });

  it.each(["customers", "bookings", "payments"])("requires export permission as well as %s read permission", async dataset => {
    fixture.branchLimited = false;
    fixture.exportAllowed = false;
    await expect(exportCsv(new Request(`https://app.example.test/api/exports/${dataset}`),
      { params: Promise.resolve({ dataset }) })).rejects.toThrow("not-found");
    expect(fixture.authorize.mock.calls.at(-1)?.[3]).toBe("report:export");
    expect(fixture.select).not.toHaveBeenCalled();
  });

  it.each(["customers", "bookings", "payments"])("requires financial permission before exporting monetary %s columns", async dataset => {
    fixture.branchLimited = false;
    fixture.financialAllowed = false;
    await expect(exportCsv(new Request(`https://app.example.test/api/exports/${dataset}`),
      { params: Promise.resolve({ dataset }) })).rejects.toThrow("not-found");
    expect(fixture.authorize.mock.calls.at(-1)?.[3]).toBe("report:view_financial");
    expect(fixture.select).not.toHaveBeenCalled();
  });
});
