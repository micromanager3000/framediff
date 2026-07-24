import { describe, expect, it } from "vitest";
import { combineCompositionSetups, defineTimelineDocument, type CompositionSetupContext } from "./composition";

describe("combineCompositionSetups", () => {
  it("runs setup in declaration order and cleanup in reverse order", async () => {
    const calls: string[] = [];
    const setup = combineCompositionSetups(
      () => { calls.push("setup-a"); return () => calls.push("cleanup-a"); },
      async () => { calls.push("setup-b"); return () => calls.push("cleanup-b"); },
    );
    const cleanup = await setup({} as CompositionSetupContext);
    expect(calls).toEqual(["setup-a", "setup-b"]);
    cleanup?.();
    expect(calls).toEqual(["setup-a", "setup-b", "cleanup-b", "cleanup-a"]);
  });
});

describe("defineTimelineDocument", () => {
  it("accepts v2 rectangles and arbitrary vector paths", () => {
    const document = defineTimelineDocument({
      version: 2,
      items: [{
        id: "shape",
        from: 0,
        durationInFrames: 90,
        layer: 0,
        layout: {
          rect: [120, 48, 960, 540],
          fit: "fill",
          focalPoint: [0.5, 0.5],
          cornerRadius: 24,
          opacity: 0.8,
        },
        content: {
          type: "shape",
          shape: "path",
          d: "M 0 50 C 25 0 75 100 100 50",
          fill: "none",
          stroke: "#ffffff",
          strokeWidth: 4,
        },
      }],
    });
    expect(document.version).toBe(2);
    expect(document.items[0].layout?.rect).toEqual([120, 48, 960, 540]);
  });

  it("rejects layout in v1 and invalid v2 geometry", () => {
    expect(() => defineTimelineDocument({
      version: 1,
      items: [{ id: "hero", from: 0, durationInFrames: 90, layout: { rect: [0, 0, 100, 100] } }],
    })).toThrow("requires timeline version 2");
    expect(() => defineTimelineDocument({
      version: 2,
      items: [{ id: "hero", from: 0, durationInFrames: 90, layout: { rect: [0, 0, 0, 100] } }],
    })).toThrow("width and height must be greater than zero");
    expect(() => defineTimelineDocument({
      version: 2,
      items: [
        { id: "hero", from: 0, durationInFrames: 90 },
        { id: "hero", from: 0, durationInFrames: 90 },
      ],
    })).toThrow("duplicated");
  });
});
