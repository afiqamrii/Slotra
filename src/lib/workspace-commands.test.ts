import { describe, expect, it } from "vitest";
import { filterWorkspaceCommands, workspaceCommands } from "./workspace-commands";
describe("workspace quick find", () => {
  it("only offers granted destinations and actions", () => {
    const commands = workspaceCommands(["/dashboard", "/calendar"], false, false);
    expect(commands.map(item => item.href)).toEqual(["/dashboard", "/calendar", "/account/security"]);
    expect(filterWorkspaceCommands(commands, "private customer", false)).toEqual([]);
  });
  it("preserves branch for booking shortcuts", () => {
    expect(workspaceCommands(["/bookings"], true, true, "branch-a").find(item => item.label === "New walk-in")?.href).toBe("/bookings/new?mode=walk-in&branchId=branch-a");
  });
  it("encodes searches without turning input into navigation", () => {
    const url = new URL(filterWorkspaceCommands([], "A&B /?", true)[0].href, "https://example.test");
    expect(url.pathname).toBe("/bookings"); expect(url.searchParams.get("q")).toBe("A&B /?");
  });
  it("finds synonyms and caps search length", () => {
    expect(filterWorkspaceCommands(workspaceCommands(["/calendar"], false, false), "agenda", false)[0].label).toBe("Calendar");
    expect(new URL(filterWorkspaceCommands([], "x".repeat(150), true)[0].href, "https://example.test").searchParams.get("q")).toHaveLength(100);
  });
});
