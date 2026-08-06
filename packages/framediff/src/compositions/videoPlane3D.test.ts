import { describe, expect, it } from "vitest";
import { defineVideoPlane3DComposition } from "./videoPlane3D";

describe("defineVideoPlane3DComposition", () => {
  it("creates a library 3D shot around the shared renderer", () => {
    const composition = defineVideoPlane3DComposition({
      id: "Plane & Push",
      name: "UI push",
      src: "asset://screen-recording",
      width: 1920,
      height: 1080,
      fps: 24,
      durationInFrames: 48,
      document: { camera: "hero" },
      meta: { document: { file: "src/PlanePush.comp.json" } },
      trimStart: 3.5,
      grade: { exposure: 0.25, bloomThreshold: 0.55 },
      effect: { maxBlur: 0.04 },
    });

    expect(composition).toMatchObject({
      id: "Plane & Push",
      width: 1920,
      height: 1080,
      fps: 24,
      durationInFrames: 48,
      definition: { version: 3, type: "three", kind: "scene", dataMode: "json" },
      meta: { library: true, sourceFormat: "generated" },
    });
    expect(composition.setup).toBeTypeOf("function");
    expect(composition.html).toContain('data-fd-src="asset://screen-recording"');
    expect(composition.html).toContain('data-fd-trim-start="3.5"');
    expect(composition.html).toContain('data-fd-grade-bloom-threshold="0.55"');
    expect(composition.html).toContain('data-fd-prop-max-blur="0.04"');
    expect(composition.html).toContain('data-fd-id="Plane &amp; Push"');
  });
});
