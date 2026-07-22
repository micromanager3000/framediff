// buildAudioClips: contiguous same-volume samples merge into one clip; a per-frame volume fade
// (Remotion's volume={(f)=>…} model) splits into per-frame gain steps that continue seamlessly
// from the same source time; gaps split clips.

import { describe, expect, it } from "vitest";
import { buildAudioClips } from "./exportVideo";

const s = (n: number, time: number, volume = 1, src = "/a.m4a") => ({ n, src, time, volume });

describe("buildAudioClips", () => {
  it("keeps negative timeline pre-roll silent and starts audio at source t0", () => {
    const clips = buildAudioClips([s(0, -2 / 24), s(1, -1 / 24), s(2, 0), s(3, 1 / 24)]);
    expect(clips).toEqual([{ src: "/a.m4a", startFrame: 2, endFrame: 4, trimStart: 0, volume: 1 }]);
  });

  it("merges a contiguous constant-volume run", () => {
    const clips = buildAudioClips([s(0, 0), s(1, 1 / 24), s(2, 2 / 24)]);
    expect(clips).toEqual([{ src: "/a.m4a", startFrame: 0, endFrame: 3, trimStart: 0, volume: 1 }]);
  });

  it("splits on a gap", () => {
    const clips = buildAudioClips([s(0, 0), s(1, 1 / 24), s(10, 0)]);
    expect(clips.length).toBe(2);
    expect(clips[1].startFrame).toBe(10);
  });

  it("a per-frame fade becomes per-frame gain steps with continuous source time", () => {
    const clips = buildAudioClips([s(0, 0, 1), s(1, 1 / 24, 1), s(2, 2 / 24, 0.5), s(3, 3 / 24, 0.25)]);
    expect(clips.map((c) => c.volume)).toEqual([1, 0.5, 0.25]);
    expect(clips.map((c) => [c.startFrame, c.endFrame])).toEqual([
      [0, 2],
      [2, 3],
      [3, 4],
    ]);
    // each step picks up the source exactly where the previous left off
    expect(clips[1].trimStart).toBeCloseTo(2 / 24, 9);
    expect(clips[2].trimStart).toBeCloseTo(3 / 24, 9);
  });

  it("keeps sources independent", () => {
    const clips = buildAudioClips([s(0, 0, 1, "/a.m4a"), s(0, 0, 1, "/b.m4a")]);
    expect(clips.length).toBe(2);
  });
});
