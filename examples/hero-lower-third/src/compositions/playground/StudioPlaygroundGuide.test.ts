import { describe, expect, it } from "vitest";
import { COMPOSITIONS } from "../../config";
import { studioPlaygroundGuide } from "./StudioPlaygroundGuide";

describe("Studio Playground guide", () => {
  it("keeps every scenario unique, actionable and reachable", () => {
    const ids = studioPlaygroundGuide.steps.map((step) => step.id);
    expect(studioPlaygroundGuide.steps).toHaveLength(17);
    expect(new Set(ids).size).toBe(ids.length);

    for (const step of studioPlaygroundGuide.steps) {
      const comp = COMPOSITIONS[step.target.compositionKey];
      expect(step.title, `${step.id} needs a title`).not.toBe("");
      expect(step.try, `${step.id} needs a concrete action`).not.toBe("");
      expect(step.success, `${step.id} needs an observable success state`).not.toBe("");
      expect(comp, `${step.id} targets an unknown composition`).toBeDefined();
      if (step.target.frame != null) {
        expect(step.target.frame, `${step.id} targets a negative frame`).toBeGreaterThanOrEqual(0);
        expect(step.target.frame, `${step.id} targets beyond the composition`).toBeLessThan(comp.durationInFrames);
      }
    }
  });

  it("covers the complete author-to-delivery loop", () => {
    expect(new Set(studioPlaygroundGuide.steps.map((step) => step.phase))).toEqual(new Set([
      "Start here",
      "Author",
      "Motion",
      "Edit",
      "Finish",
      "Simulate",
      "Generate",
      "Deliver",
    ]));
  });
});
