// Safety-critical on two axes: rewriteRecipeSource regenerates a block of user source
// (must never eat surrounding code), and recipeCanonical is the take-staleness oracle
// (its seedance shape must byte-match what shipped in 52fda87, or every pinned take on
// disk silently reads STALE).

import { describe, expect, it } from "vitest";
import { recipeCanonical, type GenRecipe } from "../generative";
import { genModelOf, GEN_MODELS } from "../genModels";
import { remapRecipeForModel, rewriteRecipeSource, serializeRecipeBody } from "./genSource";

// the real example source, verbatim (examples/hero-lower-third/src/gen/skyTimelapse.gen.tsx @ 52fda87)
const SKY = `// A generative comp: this file IS the recipe.

import { generative } from "framediff";

export const skyTimelapse = generative({
  id: "skyTimelapse",
  file: "src/gen/skyTimelapse.gen.tsx",
  provider: "fal",
  model: "seedance-2.0",
  tier: "fast",
  prompt: "Timelapse of dusk clouds rolling over a city skyline.",
  duration: 4,
  resolution: "720p",
  aspect: "16:9",
  audio: false,
  take: 1,
});
`;

const sky: GenRecipe = {
  id: "skyTimelapse",
  file: "src/gen/skyTimelapse.gen.tsx",
  provider: "fal",
  model: "seedance-2.0",
  tier: "fast",
  prompt: "Timelapse of dusk clouds rolling over a city skyline.",
  duration: 4,
  resolution: "720p",
  aspect: "16:9",
  audio: false,
  take: 1,
};

describe("rewriteRecipeSource", () => {
  it("regenerates only the generative({...}) body, preserving everything around it", () => {
    const r = rewriteRecipeSource(SKY, { ...sky, duration: 5 });
    expect(r).not.toBeNull();
    expect(r!.text).toContain("// A generative comp: this file IS the recipe.");
    expect(r!.text).toContain('import { generative } from "framediff";');
    expect(r!.text).toContain("export const skyTimelapse = generative({");
    expect(r!.text).toContain("  duration: 5,");
    expect(r!.text.trimEnd().endsWith("});")).toBe(true);
    // still exactly one call, and the result is rewritable again (round-trippable)
    expect(rewriteRecipeSource(r!.text, sky)).not.toBeNull();
  });

  it("survives braces, quotes, and escapes inside the prompt string", () => {
    const tricky = { ...sky, prompt: 'a {night} scene, sign reads "OPEN }" and \\ ends' };
    const first = rewriteRecipeSource(SKY, tricky)!;
    expect(first.text).toContain("take: 1,");
    // the tricky prompt is now IN the source; the walker must still find the real close
    const second = rewriteRecipeSource(first.text, { ...tricky, take: 2 })!;
    expect(second.text).toContain("take: 2,");
    expect(second.text.trimEnd().endsWith("});")).toBe(true);
  });

  it("refuses files without exactly one well-bracketed call", () => {
    expect(rewriteRecipeSource("const x = 1;", sky)).toBeNull();
    expect(rewriteRecipeSource(`${SKY}\nconst two = generative({ id: "x", prompt: "p" });`, sky)).toBeNull();
    expect(rewriteRecipeSource('generative({ id: "x", prompt: "unclosed', sky)).toBeNull();
  });

  it("drops params the model doesn't know and always writes take last", () => {
    const body = serializeRecipeBody({ ...sky, model: "veo-3.1-fast", seed: 7 });
    expect(body).not.toContain("tier:"); // veo has no tier
    expect(body).toContain("seed: 7,");
    expect(body.trimEnd().split("\n").pop()).toBe("  take: 1,");
  });
});

describe("remapRecipeForModel", () => {
  it("keeps identity/prompt/take, carries shared params, defaults the rest", () => {
    const { next } = remapRecipeForModel({ ...sky, duration: 4 }, "veo-3.1-fast");
    expect(next.id).toBe("skyTimelapse");
    expect(next.take).toBe(1);
    expect(next.duration).toBe(4); // veo allows 4
    expect(next.seed).toBe(0); // veo default
    expect(next.tier).toBeUndefined();
  });

  it("snaps carried values the new model's options refuse", () => {
    const { next } = remapRecipeForModel({ ...sky, duration: 15 }, "veo-3.1-fast");
    expect(next.duration).toBe(8); // 15 not in [4,6,8] → veo default
  });

  it("drops refs the target model refuses and reports them", () => {
    const withVideo: GenRecipe = { ...sky, refs: [{ kind: "video", src: "asset://a" }, { kind: "image", src: "asset://b" }] };
    const { next, droppedRefs } = remapRecipeForModel(withVideo, "veo-3.1-fast");
    expect(droppedRefs).toEqual(["asset://a"]);
    expect(next.refs).toEqual([{ kind: "image", src: "asset://b" }]);
  });

  it("drops negativePrompt when the target model has none", () => {
    const { next } = remapRecipeForModel({ ...sky, model: "kling-2.5-pro", negativePrompt: "blur" }, "seedance-2.0");
    expect(next.negativePrompt).toBeUndefined();
  });
});

describe("recipeCanonical — hash compat with shipped takes", () => {
  it("seedance canonical byte-matches the 52fda87 shape (pinned takes stay CURRENT)", () => {
    // the exact object the shipped recipeCanonical produced for this recipe
    expect(recipeCanonical(sky)).toEqual({
      endpoint: "bytedance/seedance-2.0/fast/text-to-video",
      prompt: "Timelapse of dusk clouds rolling over a city skyline.",
      refs: [],
      duration: 4,
      resolution: "720p",
      aspect: "16:9",
      audio: false,
    });
  });

  it("tier stays out of the canonical body (it's already in the endpoint)", () => {
    expect(Object.keys(recipeCanonical(sky))).not.toContain("tier");
    expect(recipeCanonical({ ...sky, tier: "standard" }).endpoint).toBe(
      "bytedance/seedance-2.0/text-to-video",
    );
  });

  it("a model switch round trip restores the identical canonical object", () => {
    const { next: veo } = remapRecipeForModel(sky, "veo-3.1-fast");
    const { next: back } = remapRecipeForModel(veo, "seedance-2.0");
    expect(recipeCanonical(back)).toEqual(recipeCanonical(sky));
  });

  it("round trips through any model keep identity + prompt + take and a canonical seedance shape", () => {
    // NOT hash-identity: a model that can't express a param (kling has no 4s, no audio
    // flag) legitimately loses it — the STALE chip after such a trip is honest, not a bug
    for (const id of Object.keys(GEN_MODELS)) {
      const { next: away } = remapRecipeForModel(sky, id);
      const { next: back } = remapRecipeForModel(away, "seedance-2.0");
      expect(back.id, `via ${id}`).toBe(sky.id);
      expect(back.prompt, `via ${id}`).toBe(sky.prompt);
      expect(back.take, `via ${id}`).toBe(sky.take);
      expect(Object.keys(recipeCanonical(back)).sort(), `via ${id}`).toEqual(
        Object.keys(recipeCanonical(sky)).sort(),
      );
    }
  });

  it("negativePrompt is hashed only for models that send it", () => {
    const kling: GenRecipe = { ...sky, model: "kling-2.5-pro", negativePrompt: "blur" };
    expect(recipeCanonical(kling).negativePrompt).toBe("blur");
    expect(recipeCanonical({ ...sky, negativePrompt: "blur" }).negativePrompt).toBeUndefined();
  });

  it("unknown model ids fall back to seedance instead of exploding old files", () => {
    expect(genModelOf({ model: "some-future-model" }).id).toBe("seedance-2.0");
  });
});

describe("comp:// refs — comps as inputs (bake-on-submit)", () => {
  const withComp: GenRecipe = { ...sky, refs: [{ kind: "video", src: "comp://harbor-previz" }] };
  const withImageComp: GenRecipe = { ...sky, refs: [{ kind: "image", src: "comp://style-frame" }] };

  it("serializes like any ref and round-trips through the literal rewrite", () => {
    const body = serializeRecipeBody(withComp);
    expect(body).toContain('refs: [{ kind: "video", src: "comp://harbor-previz" }],');
    const r = rewriteRecipeSource(SKY, withComp)!;
    expect(rewriteRecipeSource(r.text, withComp)).not.toBeNull();
  });

  it("hashes as authored — the comp:// string, not the bake bytes", () => {
    const canon = recipeCanonical(withComp);
    expect(canon.refs).toEqual([{ kind: "video", src: "comp://harbor-previz" }]);
    // a video ref flips seedance into reference-to-video, same as an asset ref
    expect(canon.endpoint).toBe("bytedance/seedance-2.0/fast/reference-to-video");
  });

  it("preserves an image-output comp as an image ref and selects image-to-video", () => {
    const body = serializeRecipeBody(withImageComp);
    expect(body).toContain('refs: [{ kind: "image", src: "comp://style-frame" }],');
    expect(recipeCanonical(withImageComp)).toMatchObject({
      endpoint: "bytedance/seedance-2.0/fast/image-to-video",
      refs: [{ kind: "image", src: "comp://style-frame" }],
    });
  });

  it("a refless recipe's canonical is untouched by the feature (hash compat holds)", () => {
    expect(recipeCanonical(sky).refs).toEqual([]);
  });

  it("model switches drop comp refs exactly when the target refuses video", () => {
    const { next: toVeo, droppedRefs } = remapRecipeForModel(withComp, "veo-3.1-fast");
    expect(toVeo.refs).toBeUndefined();
    expect(droppedRefs).toEqual(["comp://harbor-previz"]);
    const { next: toSeedance, droppedRefs: kept } = remapRecipeForModel(withComp, "seedance-2.0");
    expect(kept).toEqual([]);
    expect(toSeedance.refs).toEqual(withComp.refs);
  });
});
