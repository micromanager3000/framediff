import { describe, expect, it } from "vitest";
import { shouldShowOverture } from "./overture";

const conditions = (overrides: Partial<Parameters<typeof shouldShowOverture>[0]> = {}) => ({
  seen: false,
  automated: false,
  forced: false,
  ...overrides,
});

describe("shouldShowOverture", () => {
  it("greets a first-time human", () => {
    expect(shouldShowOverture(conditions())).toBe(true);
  });

  it("only greets them once", () => {
    expect(shouldShowOverture(conditions({ seen: true }))).toBe(false);
  });

  it("never stands between automation and the application", () => {
    // The agent surface and the e2e suite both drive this UI. A curtain a script has to know how
    // to dismiss would break every one of them on a fresh profile.
    expect(shouldShowOverture(conditions({ automated: true }))).toBe(false);
    expect(shouldShowOverture(conditions({ automated: true, seen: false }))).toBe(false);
  });

  it("can still be forced, so the overture itself stays testable", () => {
    expect(shouldShowOverture(conditions({ automated: true, forced: true }))).toBe(true);
    // The override beats "already seen" too, so a test can replay it deterministically.
    expect(shouldShowOverture(conditions({ seen: true, forced: true }))).toBe(true);
  });
});
