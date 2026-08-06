import { describe, expect, it } from "vitest";
import {
  COMPOSITION_DEFINITION_VERSION,
  combineCompositionSetups,
  defineComposition,
  defineCompositionRegistry,
  defineTimelineDocument,
  type CompositionConfig,
  type CompositionSetupContext,
} from "./composition";

const htmlComposition = (id: string, kind = "scene") => `<!doctype html><main data-fd-composition data-fd-id="${id}" data-fd-kind="${kind}" data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="90"></main>`;

describe("composition definitions", () => {
  it("separates a versioned runtime type from semantic authoring kind", () => {
    const composition = defineComposition(htmlComposition("Title"));
    expect(composition.definition).toEqual({
      version: COMPOSITION_DEFINITION_VERSION,
      type: "html",
      kind: "scene",
    });
  });

  it("rejects runtime adapter names used as semantic kinds", () => {
    expect(() => defineComposition(htmlComposition("OldGenerator", "generate"))).toThrow(
      'Runtime adapters belong in definition.type',
    );
    expect(() => defineComposition(htmlComposition("OldCustom", "custom"))).toThrow(
      'unsupported kind "custom"',
    );
  });

  it("validates the latest-only project registry boundary", () => {
    const current = defineComposition(htmlComposition("Current"));
    expect(defineCompositionRegistry({ current })).toEqual({ current });
    const stale = {
      ...current,
      definition: { ...current.definition, version: 0 },
    } as unknown as CompositionConfig;
    expect(() => defineCompositionRegistry({ stale })).toThrow("FrameDiff requires version 1");
    expect(defineCompositionRegistry({ first: current, alias: current })).toEqual({ first: current, alias: current });
    const duplicate = defineComposition(htmlComposition("Current"));
    expect(() => defineCompositionRegistry({ first: current, duplicate })).toThrow("belongs to more than one definition");
  });
});

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
