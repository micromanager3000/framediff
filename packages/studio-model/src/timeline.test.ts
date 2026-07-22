import { describe, expect, it } from "vitest";
import { artifactStatusFromInputs, buildTimelineLanes, frontTrimPlacement } from "./timeline";
import type { TimelineItemSnapshot } from "./types";

const item = (id: string, from: number, layer?: number): TimelineItemSnapshot => ({
  id,
  from,
  durationInFrames: 30,
  order: 0,
  ...(layer == null ? {} : { layer }),
  origin: "sequence",
  editable: { from: true, duration: true, layer: true, trimStart: true },
  content: { type: "video", src: `asset://${id}`, trimStart: 1, playbackRate: 1.5 },
});

describe("persistent editorial lanes", () => {
  it("uses authored layers even when clips do not overlap", () => {
    const lanes = buildTimelineLanes([item("base", 0, 0), item("title", 90, 2), item("logo", 30, 1)]);
    expect(lanes.map((lane) => ({ id: lane.id, authority: lane.authority, items: lane.items.map((entry) => entry.id) }))).toEqual([
      { id: "v:2", authority: "explicit", items: ["title"] },
      { id: "v:1", authority: "explicit", items: ["logo"] },
      { id: "v:0", authority: "explicit", items: ["base"] },
    ]);
  });

  it("keeps overlap packing only as a labeled legacy fallback", () => {
    const lanes = buildTimelineLanes([item("a", 0), item("b", 10), item("c", 40)]);
    expect(lanes.map((lane) => ({ authority: lane.authority, items: lane.items.map((entry) => entry.id) }))).toEqual([
      { authority: "legacy", items: ["b"] },
      { authority: "legacy", items: ["a", "c"] },
    ]);
  });

  it("front-trims in source seconds with playback rate", () => {
    expect(frontTrimPlacement(item("video", 10, 0), 22, 30)).toEqual({
      from: 22,
      durationInFrames: 18,
      trimStart: 1.6,
    });
  });

  it("preserves negative pre-roll so a left extension can hold the first visual frame", () => {
    expect(frontTrimPlacement(item("video", 30, 0), -10, 30)).toEqual({
      from: -10,
      durationInFrames: 70,
      trimStart: -1,
    });
  });

  it("marks a bake current only while every recorded source hash still matches", () => {
    const current = new Map([["Comp.html", "sha256:a"], ["Motion.ts", "sha256:b"]]);
    expect(artifactStatusFromInputs({ "Comp.html": "sha256:a", "Motion.ts": "sha256:b" }, current)).toBe("current");
    expect(artifactStatusFromInputs({ "Comp.html": "sha256:older" }, current)).toBe("stale");
    expect(artifactStatusFromInputs(undefined, current)).toBe("untracked");
  });
});
