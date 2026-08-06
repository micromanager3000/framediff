import { describe, expect, it } from "vitest";
import type { CompositionDescriptor, StudioSessionState, TimelineItemSnapshot } from "./types";
import { renderTargetCompositions, selectedRenderTarget } from "./renderTargets";

const composition = (
  key: string,
  kind: CompositionDescriptor["kind"],
  library = false,
  type: CompositionDescriptor["type"] = "html",
): CompositionDescriptor => ({
  key,
  id: key,
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 90,
  definitionVersion: 1,
  type,
  kind,
  outputKind: "video",
  library,
});

const nested = (compId: string): TimelineItemSnapshot => ({
  id: `nested-${compId}`,
  from: 0,
  durationInFrames: 90,
  order: 0,
  origin: "sequence",
  content: { type: "nested", compId, trimStart: 0 },
});

const state = (currentKey = "main"): Pick<
  StudioSessionState,
  "compositions" | "currentKey" | "path" | "timelineByComposition"
> => ({
  compositions: [
    composition("lighthouse-workflow", "edit"),
    composition("lighthouse-dialogue", "scene", false, "generative"),
    composition("main", "edit"),
    composition("moodboard", "board", true, "moodboard"),
  ],
  currentKey,
  path: currentKey === "lighthouse-dialogue"
    ? ["lighthouse-workflow", "lighthouse-dialogue"]
    : [currentKey],
  timelineByComposition: {
    "lighthouse-workflow": [nested("lighthouse-dialogue")],
  },
});

describe("render targets", () => {
  it("lists only non-library edit compositions as project deliverables", () => {
    expect(renderTargetCompositions(state()).map(({ key }) => key)).toEqual([
      "lighthouse-workflow",
      "main",
    ]);
  });

  it("keeps a nested selection attached to its top-level render target", () => {
    const snapshot = state("lighthouse-dialogue");
    expect(selectedRenderTarget(snapshot)?.key).toBe("lighthouse-workflow");
  });

  it("falls back to the active composition in a project without edit roots", () => {
    const snapshot = state("lighthouse-dialogue");
    snapshot.compositions = [composition("lighthouse-dialogue", "scene", false, "generative")];
    snapshot.path = ["lighthouse-dialogue"];
    expect(renderTargetCompositions(snapshot).map(({ key }) => key)).toEqual(["lighthouse-dialogue"]);
  });
});
