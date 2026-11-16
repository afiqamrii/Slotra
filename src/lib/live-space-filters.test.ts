import { describe, expect, it } from "vitest";
import { filterLiveSpaces, spaceStatusGroup } from "./live-space-filters";

describe("reception space filters", () => {
  const spaces = [
    { name: "Court A", sportName: "Badminton", state: "AVAILABLE" },
    { name: "Court B", sportName: "Badminton", state: "HELD" },
    { name: "Pitch 1", sportName: "Futsal", state: "IN_USE" },
    { name: "Court C", sportName: "Badminton", state: "MAINTENANCE" },
  ];
  it("groups payment holds with occupied spaces, never available", () => {
    expect(filterLiveSpaces(spaces, "", "occupied")).toEqual([spaces[1], spaces[2]]);
    expect(filterLiveSpaces(spaces, "", "available")).toEqual([spaces[0]]);
  });
  it("combines literal case-insensitive name/sport search with status", () => {
    expect(filterLiveSpaces(spaces, " BADMINTON ", "occupied")).toEqual([spaces[1]]);
    expect(filterLiveSpaces(spaces, "Court C", "all")).toEqual([spaces[3]]);
    expect(filterLiveSpaces(spaces, "%", "all")).toEqual([]);
  });
  it("treats blocked, inactive, closed and unknown states as unavailable", () => {
    for (const state of ["BLOCKED", "DISABLED", "MAINTENANCE", "CLOSED", "UNKNOWN"])
      expect(spaceStatusGroup(state)).toBe("unavailable");
  });
});
