import { describe, it, expect } from "vitest";
import { defineComposition } from "../graph/planner";
import { createPrecompBaker, resolveComposition } from "./precomp";
import { MemoryCAS } from "../assets/cas";
import type { MediaBundle } from "./mediaBundle";
import type { ResolvedNode } from "../graph/scheduler";

const subComp = { id: "Intro", html: '<main data-fd-composition data-fd-id="Intro" data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="60"></main>', width: 1920, height: 1080, fps: 30, durationInFrames: 60 };

describe("precomp baking", () => {
  it("bakes a sub-composition into a MediaBundle and caches by fingerprint", async () => {
    let exports = 0;
    const exportComposition = async () => {
      exports++;
      return new Uint8Array([1, 2, 3, 4]).buffer;
    };
    const baker = createPrecompBaker({
      exportComposition,
      cas: new MemoryCAS(),
      compositions: { Intro: subComp },
      target: { w: 1920, h: 1080 },
      makeObjectURL: () => "blob:v",
    });
    const cache = new Map<string, ResolvedNode>();
    const cacheAdapter = { get: (fp: string) => cache.get(fp), set: (fp: string, r: ResolvedNode) => void cache.set(fp, r) };

    const def = defineComposition({
      id: "Final",
      html: '<main data-fd-composition data-fd-id="Final" data-fd-width="1920" data-fd-height="1080" data-fd-fps="30" data-fd-duration="120"></main>',
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 120,
      build: (ctx) => ({ intro: ctx.precomp("introNode", { composition: "Intro" }) }),
    });

    const r1 = await resolveComposition(def, { target: { w: 1920, h: 1080 }, bakers: { precomp: baker }, cache: cacheAdapter });
    const bundle = r1.intro.value as MediaBundle;
    expect(bundle.video.width).toBe(1920);
    expect(bundle.durationInFrames).toBe(60);
    expect(bundle.video.url).toBe("blob:v");
    expect(exports).toBe(1);

    // second resolve: fingerprint known ⇒ no re-bake
    const r2 = await resolveComposition(def, { target: { w: 1920, h: 1080 }, bakers: { precomp: baker }, cache: cacheAdapter });
    expect(exports).toBe(1);
    expect(r2.intro.fingerprint).toBe(r1.intro.fingerprint);
  });
});
