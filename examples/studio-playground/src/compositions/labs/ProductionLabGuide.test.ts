import { describe, expect, it } from "vitest";
import { COMPOSITIONS } from "../../config";
import { productionLabGuide } from "./ProductionLabGuide";

describe("Production Lab guide", () => {
  it("keeps every workflow id unique and every target composition reachable", () => {
    const ids = productionLabGuide.steps.map((step) => step.id);
    expect(productionLabGuide.steps).toHaveLength(17);
    expect(new Set(ids).size).toBe(ids.length);

    const compositionKeys = new Set(Object.keys(COMPOSITIONS));
    for (const step of productionLabGuide.steps) {
      expect(step.title, `${step.id} needs a title`).not.toBe("");
      expect(step.try, `${step.id} needs a concrete action`).not.toBe("");
      expect(step.success, `${step.id} needs an observable success state`).not.toBe("");
      expect(compositionKeys.has(step.target.compositionKey), `${step.id} targets an unknown composition`).toBe(true);
      if (step.target.frame != null) expect(step.target.frame, `${step.id} targets a negative frame`).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers every vertical workflow phase", () => {
    expect(new Set(productionLabGuide.steps.map((step) => step.phase))).toEqual(new Set([
      "Start here",
      "Design",
      "Assets",
      "Editorial",
      "Motion",
      "Finishing",
      "Generate",
      "Source",
      "Deliver",
    ]));
  });
});
