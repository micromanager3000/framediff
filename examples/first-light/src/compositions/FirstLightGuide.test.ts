import { describe, expect, it } from "vitest";
import { COMPOSITIONS, project } from "../config";
import { firstLightGuide } from "./FirstLightGuide";

describe("First Light guide", () => {
  it("is the project's guide, and opens on the root composition", () => {
    expect(project.guide).toBe(firstLightGuide);
    expect(firstLightGuide.entryCompositionKey).toBe("first-light");
  });

  it("keeps the step ids progress is remembered under", () => {
    expect(firstLightGuide.steps.map((step) => step.id)).toEqual([
      "watch", "stage", "nested", "drag", "text", "field", "trim", "code", "feel", "render",
    ]);
  });

  it("targets a real composition and a real frame at every step", () => {
    expect(firstLightGuide.steps).toHaveLength(10);

    for (const step of firstLightGuide.steps) {
      const comp = COMPOSITIONS[step.target.compositionKey];
      expect(comp, `${step.id} targets an unknown composition`).toBeDefined();
      if (step.target.frame != null) {
        expect(step.target.frame, `${step.id} targets a negative frame`).toBeGreaterThanOrEqual(0);
        expect(step.target.frame, `${step.id} targets beyond the composition`).toBeLessThan(comp.durationInFrames);
      }
    }
  });

  it("walks the whole arc, from watching it to shipping it", () => {
    expect([...new Set(firstLightGuide.steps.map((step) => step.phase))]).toEqual([
      "WATCH",
      "STRUCTURE",
      "EDIT",
      "SOURCE",
      "STUDIO",
      "DELIVER",
    ]);
  });
});
