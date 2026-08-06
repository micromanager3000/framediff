import { describe, expect, it } from "vitest";
import {
  COMPOSITION_DEFINITION_VERSION,
  combineCompositionSetups,
  defineCodeScene,
  defineComposition,
  defineCompositionRegistry,
  defineTimelineDocument,
  type CompositionConfig,
  type CompositionSetupContext,
} from "./composition";

const htmlComposition = (id: string, kind = "scene", content = "") => `<!doctype html><main data-fd-composition data-fd-id="${id}" data-fd-kind="${kind}" data-fd-data-mode="source" data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="90">${content}</main>`;

describe("composition definitions", () => {
  it("separates a versioned runtime type from semantic authoring kind", () => {
    const composition = defineCodeScene(htmlComposition("Title"), { capabilities: ["dom"] });
    expect(composition.definition).toEqual({
      version: COMPOSITION_DEFINITION_VERSION,
      type: "html",
      kind: "scene",
      dataMode: "source",
    });
  });

  it("rejects runtime adapter names used as semantic kinds", () => {
    expect(() => defineComposition(htmlComposition("OldGenerator", "generate"), { dataMode: "source" })).toThrow(
      'Runtime adapters belong in definition.type',
    );
    expect(() => defineComposition(htmlComposition("OldCustom", "custom"), { dataMode: "source" })).toThrow(
      'unsupported kind "custom"',
    );
  });

  it("validates the latest-only project registry boundary", () => {
    const current = defineCodeScene(htmlComposition("Current"), { capabilities: ["dom"] });
    expect(defineCompositionRegistry({ current })).toEqual({ current });
    const stale = {
      ...current,
      definition: { ...current.definition, version: 0 },
    } as unknown as CompositionConfig;
    expect(() => defineCompositionRegistry({ stale })).toThrow("FrameDiff requires version 3");
    expect(defineCompositionRegistry({ first: current, alias: current })).toEqual({ first: current, alias: current });
    const duplicate = defineCodeScene(htmlComposition("Current"), { capabilities: ["dom"] });
    expect(() => defineCompositionRegistry({ first: current, duplicate })).toThrow("belongs to more than one definition");
  });

  it("requires JSON by default and limits source ownership to HTML runtimes", () => {
    expect(() => defineComposition(htmlComposition("Undeclared").replace(' data-fd-data-mode="source"', ""))).toThrow("must declare JSON creative data");
    expect(defineComposition(htmlComposition("Edit", "edit"), { dataMode: "source" }).definition.dataMode).toBe("source");
    expect(() => defineComposition(htmlComposition("Three"), { type: "three", dataMode: "source" })).toThrow("only HTML compositions");
    expect(() => defineComposition(htmlComposition("Missing"), { dataMode: "json" })).toThrow("declares no JSON data file");
  });

  it("enforces the code-scene capability and dependency boundary", () => {
    const nested = htmlComposition("Nested", "scene", '<div data-fd-type="nested" data-fd-comp="Child"></div>');
    expect(() => defineCodeScene(nested, { capabilities: ["dom"] })).toThrow("without declaring it in dependencies.compositions");
    expect(() => defineCodeScene(nested, {
      capabilities: ["dom", "nested-compositions"],
      dependencies: { compositions: ["Child"] },
    })).not.toThrow();
    expect(() => defineCodeScene(htmlComposition("Canvas", "scene", "<canvas></canvas>"), { capabilities: ["dom"] })).toThrow("declares no canvas-2d, webgl, or webgpu capability");
    expect(() => defineCodeScene(htmlComposition("Clock", "scene", "<script>requestAnimationFrame(() => {});</script>"), { capabilities: ["dom"] })).toThrow("requestAnimationFrame");
    expect(() => defineCodeScene(htmlComposition("Global", "scene", "<script>window.addEventListener('resize', () => {});</script>"), { capabilities: ["dom"] })).toThrow("global window access");
  });

  it("rejects ad-hoc source ownership at the project registry", () => {
    const adHoc = defineComposition(htmlComposition("AdHoc"), { dataMode: "source" });
    expect(() => defineCompositionRegistry({ adHoc })).toThrow("defineCodeScene");
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
