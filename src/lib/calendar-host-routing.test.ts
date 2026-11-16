import { describe, expect, it } from "vitest";
import { publicHostPath } from "./host-routing";

describe("private calendar download host paths", () => {
  it("routes downloads on the dedicated booking host", () => {
    expect(publicHostPath("/play-arena/confirmation/opaque-token/calendar.ics")).toBe("/book/play-arena/confirmation/opaque-token/calendar.ics");
  });
  it("scopes custom-domain paths to the resolved tenant", () => {
    expect(publicHostPath("/confirmation/opaque-token/calendar.ics", "play-arena")).toBe("/book/play-arena/confirmation/opaque-token/calendar.ics");
    expect(publicHostPath("/book/play-arena/confirmation/opaque-token/calendar.ics", "play-arena")).toBe("/book/play-arena/confirmation/opaque-token/calendar.ics");
    expect(publicHostPath("/other-arena/confirmation/opaque-token/calendar.ics", "play-arena")).toBeNull();
    expect(publicHostPath("/book/other-arena/confirmation/opaque-token/calendar.ics", "play-arena")).toBeNull();
  });
  it.each(["/play-arena/confirmation/token/calendar.html", "/play-arena/confirmation/token/calendar.ics/extra", "/play-arena/calendar.ics", "/admin/confirmation/token/calendar.ics"])("rejects unrelated download paths: %s", path => {
    expect(publicHostPath(path)).toBeNull();
  });
});
