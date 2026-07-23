import { describe, expect, it } from "vitest";
import {
  COMPOSITION_KIND_CONTRACTS,
  resolveCompositionAuthoring,
  type CompositionAuthoringDescriptor,
  type CompositionDescriptor,
  type CompositionKind,
  type TimelineItemSnapshot,
} from "@framediff/studio-model";
import { shouldShowTimeline } from "./authoring";

const composition = (
  kind: CompositionKind,
  authoring?: CompositionAuthoringDescriptor,
): CompositionDescriptor => ({
  key: "demo",
  id: "Demo",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 120,
  kind,
  outputKind: "video",
  ...(authoring ? { authoring } : {}),
});

const item = (
  type: "layers" | "nested" | "video",
  from = 0,
  durationInFrames = 120,
  editable?: TimelineItemSnapshot["editable"],
): TimelineItemSnapshot => ({
  id: `${type}-item`,
  from,
  durationInFrames,
  content: type === "layers"
    ? { type, label: "Canvas" }
    : type === "video"
      ? { type, src: "asset://plate" }
      : { type: "nested", compId: "Child", trimStart: 0 },
  order: 0,
  origin: "sequence",
  ...(editable ? { editable } : {}),
});

describe("composition authoring surfaces", () => {
  it("has one deliberate contract for every public composition kind", () => {
    expect(COMPOSITION_KIND_CONTRACTS.map((contract) => contract.kind)).toEqual([
      "edit", "scene", "3d", "generate", "audio", "plan", "doc", "script",
      "storyboard", "board", "moodboard", "locations", "cast",
    ]);
    expect(new Set(COMPOSITION_KIND_CONTRACTS.map((contract) => contract.kind)).size).toBe(13);
  });

  it.each([
    ["edit", true, true, true, true],
    ["3d", false, true, true, false],
    ["generate", false, false, false, false],
    ["audio", true, true, false, false],
    ["doc", false, false, true, false],
    ["plan", true, true, true, false],
    ["scene", false, true, true, false],
    ["board", false, false, true, false],
    ["moodboard", false, false, true, false],
    ["script", false, false, true, false],
    ["storyboard", false, false, true, false],
    ["locations", false, false, true, false],
    ["cast", false, false, true, false],
  ] as const)("resolves %s defaults", (kind, timeline, transport, directManipulation, acceptsCompositionDrop) => {
    expect(resolveCompositionAuthoring(composition(kind))).toEqual({
      timeline,
      transport,
      directManipulation,
      acceptsCompositionDrop,
    });
  });

  it("gives a leaf render comp a scrubber unless it has actual timeline editing", () => {
    const scene = composition("scene");
    expect(shouldShowTimeline(scene, [item("layers")], [], [])).toBe(false);
    expect(shouldShowTimeline(scene, [item("layers", 10, 80)], [], [])).toBe(true);
    expect(shouldShowTimeline(scene, [item("nested")], [], [])).toBe(false);
    expect(shouldShowTimeline(scene, [item("nested", 0, 120, { from: true, duration: true })], [], [])).toBe(true);
    expect(shouldShowTimeline(scene, [item("video", 0, 120, { from: false, duration: true })], [], [])).toBe(false);
    expect(shouldShowTimeline(scene, [item("nested"), { ...item("video"), id: "video-2", order: 1 }], [], [])).toBe(true);

    const videoPlane = composition("3d");
    expect(resolveCompositionAuthoring(videoPlane, [item("video")])).toMatchObject({ timeline: false, transport: true });
  });

  it("gives timed scripts and storyboards temporal UI without turning static documents into edits", () => {
    expect(resolveCompositionAuthoring(composition("script"), [item("nested")])).toMatchObject({ timeline: true, transport: true });
    expect(resolveCompositionAuthoring(composition("storyboard"), [item("layers", 0, 60)])).toMatchObject({ timeline: true, transport: true });
    expect(resolveCompositionAuthoring(composition("doc"), [item("nested")])).toMatchObject({ timeline: false, transport: false });
  });

  it("lets composition metadata intentionally override kind defaults", () => {
    expect(resolveCompositionAuthoring(composition("edit", {
      timeline: "hidden",
      transport: "hidden",
      directManipulation: false,
    }))).toMatchObject({ timeline: false, transport: false, directManipulation: false });
    expect(resolveCompositionAuthoring(composition("doc", {
      timeline: "always",
      transport: "always",
      directManipulation: true,
    }))).toMatchObject({ timeline: true, transport: true, directManipulation: true });
  });
});
