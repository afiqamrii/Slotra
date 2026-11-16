import { describe, expect, it } from "vitest";
import { bookingTime } from "./booking-format";
import { bookingTimeLabel } from "./booking-time-label";

describe("booking time labels", () => {
  it("distinguishes both occurrences of New York's repeated 1 am", () => {
    const timezone = "America/New_York";
    const earlier = "2026-11-01T05:00:00Z";
    const later = "2026-11-01T06:00:00Z";

    expect(new Date(earlier).getTime()).not.toBe(new Date(later).getTime());
    expect(bookingTime(earlier, timezone)).toBe(bookingTime(later, timezone));
    expect(bookingTimeLabel(earlier, timezone)).toBe(`${bookingTime(earlier, timezone)} (UTC-04:00)`);
    expect(bookingTimeLabel(later, timezone)).toBe(`${bookingTime(later, timezone)} (UTC-05:00)`);
    expect(bookingTimeLabel(earlier, timezone)).not.toBe(bookingTimeLabel(later, timezone));
  });

  it("preserves ordinary Malaysian labels for both Date and string inputs", () => {
    const instant = "2026-11-16T04:30:00Z";
    const timezone = "Asia/Kuala_Lumpur";
    expect(bookingTimeLabel(instant, timezone)).toBe(bookingTime(instant, timezone));
    expect(bookingTimeLabel(new Date(instant), timezone)).toBe(bookingTime(instant, timezone));
  });

  it("adds offsets only inside the repeated interval, including its precise end", () => {
    const timezone = "America/New_York";
    for (const instant of ["2026-11-01T04:59:59Z", "2026-11-01T07:00:00Z"]) {
      expect(bookingTimeLabel(instant, timezone)).toBe(bookingTime(instant, timezone));
    }
    expect(bookingTimeLabel("2026-11-01T05:59:59.999Z", timezone)).toContain("(UTC-04:00)");
    expect(bookingTimeLabel("2026-11-01T06:59:59.999Z", timezone)).toContain("(UTC-05:00)");
  });

  it("handles Lord Howe's thirty-minute fallback without marking the entire hour ambiguous", () => {
    const timezone = "Australia/Lord_Howe";
    const earlier = "2026-04-04T14:45:00Z";
    const later = "2026-04-04T15:15:00Z";

    expect(bookingTime(earlier, timezone)).toBe(bookingTime(later, timezone));
    expect(bookingTimeLabel(earlier, timezone)).toBe(`${bookingTime(earlier, timezone)} (UTC+11:00)`);
    expect(bookingTimeLabel(later, timezone)).toBe(`${bookingTime(later, timezone)} (UTC+10:30)`);
    for (const instant of ["2026-04-04T14:29:59Z", "2026-04-04T15:30:00Z"]) {
      expect(bookingTimeLabel(instant, timezone)).toBe(bookingTime(instant, timezone));
    }
  });

  it("does not mark actual instants around a spring-forward gap ambiguous", () => {
    const timezone = "America/New_York";
    for (const instant of ["2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z"]) {
      expect(bookingTimeLabel(instant, timezone)).toBe(bookingTime(instant, timezone));
    }
  });
});
