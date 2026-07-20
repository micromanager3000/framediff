import { describe, expect, it } from "vitest";
import { normalizeTweenTrace, tweenTracesEqual, type NormalizedTweenOperation } from "./animation";

describe("frame-native animation contract", () => {
  it("recognizes helper-expanded tweens as the same trace", () => {
    const helperTrace: NormalizedTweenOperation[] = [{
      target: "title",
      kind: "fromTo",
      startFrame: 10,
      durationInFrames: 30,
      from: { opacity: 0, x: 0 },
      to: { opacity: 1, x: 320 },
      ease: "power2.out",
    }];
    const explicitTrace: NormalizedTweenOperation[] = [{
      target: "title",
      kind: "fromTo",
      startFrame: 10.1,
      durationInFrames: 29.7,
      from: { x: 0, opacity: 0 },
      to: { x: 320, opacity: 1 },
      ease: "power2.out",
    }];
    expect(tweenTracesEqual(helperTrace, explicitTrace)).toBe(true);
    expect(normalizeTweenTrace(explicitTrace)[0]).toMatchObject({ startFrame: 10, durationInFrames: 30 });
  });

  it("does not erase meaningful operation order", () => {
    const first: NormalizedTweenOperation = { target: "title", kind: "set", startFrame: 0, durationInFrames: 0, to: { x: 0 } };
    const second: NormalizedTweenOperation = { target: "title", kind: "to", startFrame: 1, durationInFrames: 10, to: { x: 100 } };
    expect(tweenTracesEqual([first, second], [second, first])).toBe(false);
  });
});
