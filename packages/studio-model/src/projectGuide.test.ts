import { describe, expect, it } from "vitest";
import { COMMON_GUIDE_STEPS, defineProjectGuide, guidePhases } from "./projectGuide";

const target = { compositionKey: "root", frame: 0 };

function guide(steps: Parameters<typeof defineProjectGuide>[0]["steps"]) {
  return defineProjectGuide({ id: "tour", title: "Tour", summary: "A tour.", steps });
}

describe("defineProjectGuide", () => {
  it("fills a common step from its blueprint and keeps the project's target", () => {
    const resolved = guide([{ common: "render", target }]);
    const step = resolved.steps[0];

    expect(step.id).toBe("render");
    expect(step.phase).toBe(COMMON_GUIDE_STEPS.render.phase);
    expect(step.title).toBe(COMMON_GUIDE_STEPS.render.title);
    expect(step.try).toBe(COMMON_GUIDE_STEPS.render.try);
    expect(step.target).toEqual(target);
  });

  it("lets a project override any sentence it wants to own", () => {
    const resolved = guide([
      { common: "play", title: "Play the whole piece", success: "The aurora drifts.", target },
    ]);
    const step = resolved.steps[0];

    expect(step.title).toBe("Play the whole piece");
    expect(step.success).toBe("The aurora drifts.");
    // Everything not overridden still comes from the shared half.
    expect(step.description).toBe(COMMON_GUIDE_STEPS.play.description);
  });

  it("accepts fully custom steps and project-specific phases beside common ones", () => {
    const resolved = guide([
      { common: "play", target },
      {
        id: "words",
        phase: "COPY",
        title: "Change the words",
        description: "Copy is data.",
        try: "Type something.",
        success: "The canvas updates.",
        target: { compositionKey: "aperture" },
      },
    ]);

    expect(resolved.steps.map((step) => step.id)).toEqual(["play", "words"]);
    expect(guidePhases(resolved)).toEqual(["WATCH", "COPY"]);
  });

  it("reuses one blueprint twice when the steps are given their own ids", () => {
    const resolved = guide([
      { common: "properties", id: "colour", target },
      { common: "properties", id: "layout", target: { compositionKey: "field" } },
    ]);

    expect(resolved.steps.map((step) => step.id)).toEqual(["colour", "layout"]);
  });

  it("derives the entry composition from the first step", () => {
    expect(guide([{ common: "play", target: { compositionKey: "first-light" } }]).entryCompositionKey)
      .toBe("first-light");
  });

  it("defaults the kicker and keeps an explicit one", () => {
    expect(guide([{ common: "play", target }]).kicker).toBe("PROJECT WALKTHROUGH");
    expect(defineProjectGuide({ id: "t", title: "T", summary: "S", kicker: "TOUR", steps: [{ common: "play", target }] }).kicker)
      .toBe("TOUR");
  });

  it("refuses a guide that cannot be followed", () => {
    expect(() => guide([])).toThrow(/at least one step/);
    expect(() => guide([{ common: "play", target }, { common: "play", target }]))
      .toThrow(/repeats the step id "play"/);
    expect(() => guide([{ common: "play", try: "  ", target }])).toThrow(/concrete action/);
    expect(() => guide([{ common: "play", success: "", target }])).toThrow(/observable success/);
    expect(() => guide([{ common: "play", target: { compositionKey: "" } }])).toThrow(/target composition/);
    expect(() => defineProjectGuide({ id: "", title: "T", summary: "S", steps: [{ common: "play", target }] }))
      .toThrow(/needs an id/);
    // A JS caller can still reach this; TypeScript catches it at the call site.
    expect(() => guide([{ common: "nope" as "play", target }])).toThrow(/unknown common step/);
  });
});
