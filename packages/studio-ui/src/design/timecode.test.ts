import { describe, expect, it } from "vitest";
import { formatDuration, formatTimecode, frameParts } from "./timecode";

describe("frameParts", () => {
  it("splits a frame index at the composition rate", () => {
    expect(frameParts(0, 24)).toEqual({ hours: 0, minutes: 0, seconds: 0, frames: 0 });
    expect(frameParts(25, 24)).toEqual({ hours: 0, minutes: 0, seconds: 1, frames: 1 });
    expect(frameParts(24 * 60, 24)).toEqual({ hours: 0, minutes: 1, seconds: 0, frames: 0 });
    expect(frameParts(24 * 3661, 24)).toEqual({ hours: 1, minutes: 1, seconds: 1, frames: 0 });
  });

  it("falls back to 24fps rather than dividing by zero", () => {
    expect(frameParts(48, 0)).toEqual({ hours: 0, minutes: 0, seconds: 2, frames: 0 });
  });

  it("rounds fractional rates to a whole frame count per second", () => {
    // 23.976 is stored as-is but reads out in 24 slots; frame 24 is the start of second one.
    expect(frameParts(24, 23.976)).toMatchObject({ seconds: 1, frames: 0 });
  });
});

describe("formatTimecode", () => {
  it("uses MM:SS:FF until there is an hour to show", () => {
    expect(formatTimecode(0, 24)).toBe("00:00:00");
    expect(formatTimecode(2070, 30)).toBe("01:09:00");
  });

  it("widens to HH:MM:SS:FF past an hour", () => {
    expect(formatTimecode(24 * 3600, 24)).toBe("01:00:00:00");
  });

  it("never emits a negative timecode", () => {
    expect(formatTimecode(-40, 24)).toBe("00:00:00");
  });
});

describe("formatDuration", () => {
  it("keeps a decimal under ten seconds", () => {
    expect(formatDuration(41, 24)).toBe("1.7s");
  });

  it("drops to whole seconds, then minutes", () => {
    expect(formatDuration(24 * 30, 24)).toBe("30s");
    expect(formatDuration(2070, 30)).toBe("1m 9s");
    expect(formatDuration(24 * 120, 24)).toBe("2m");
  });
});
