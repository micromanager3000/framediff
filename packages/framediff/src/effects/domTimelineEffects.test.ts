import { describe, expect, it } from "vitest";
import { createWipeRevealSetup, evaluateClipMotion2D, type ClipMotion2D } from "./domTimelineEffects";
import { gradeDataAttributes } from "./gradeAttributes";

describe("project-configurable effect helpers", () => {
  it("evaluates source-space clip motion independently of a composition", () => {
    const motion: ClipMotion2D = {
      anchor: [50, 25],
      sourceSize: [100, 50],
      startFrame: 0,
      endFrame: 10,
      startPosition: [0, 10],
      endPosition: [100, 30],
      startScale: 0.5,
      endScale: 1,
    };
    expect(evaluateClipMotion2D(motion, 5)).toEqual({ x: 50, y: 20, scale: 0.75 });
  });

  it("uses the containing clip clock when a wipe is authored on a child element", () => {
    const owner = { dataset: { fdLocalFrame: "51" } };
    const style: Record<string, string> = {};
    const wipe = {
      dataset: { fdWipe: "smooth", fdWipeFrom: "28", fdWipeTo: "74" },
      style,
      matches: () => false,
      closest: () => owner,
    };
    let listener: ((state: never) => void) | undefined;
    createWipeRevealSetup()({
      root: { querySelectorAll: () => [wipe] },
      onFrame: (next: (state: never) => void) => { listener = next; return () => undefined; },
      onCleanup: () => undefined,
    } as never);

    listener!({} as never);
    expect(style.clipPath).toBe("inset(0 50% 0 0)");
  });

  it("serializes typed grade fields to the HTML effect ABI", () => {
    expect(gradeDataAttributes({ exposure: 0.2, bloomThreshold: 0.55 })).toEqual({
      "data-fd-grade-exposure": 0.2,
      "data-fd-grade-bloom-threshold": 0.55,
    });
  });
});
