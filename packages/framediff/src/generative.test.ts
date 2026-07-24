import { beforeEach, describe, expect, it } from "vitest";
import {
  __generativeTest,
  generative,
  genDims,
  genNativeDims,
  genOutputKindOf,
  genRecipeSnapshotOf,
  genTakesFrom,
  primeGenTakes,
  forkGenRecipe,
  type GenRecipe,
  type GenTake,
  recipeCanonical,
} from "./generative";

const take = (n: number, hash = `sha256:t${n}`): GenTake => ({
  assetId: `asset-${n}`,
  contentHash: hash,
  bytes: n * 100,
  generator: {
    gen: "shot",
    take: n,
    recipeHash: "sha256:recipe",
    endpoint: "provider/model",
    recipe: { prompt: "prompt", refs: [{ kind: "image", src: "asset://reference" }] },
    inputs: [{ kind: "image", src: "asset://reference", contentHash: "sha256:reference" }],
  },
});

describe("starting a new take from a historical recipe", () => {
  it("forks creative settings without replacing composition identity or its pin", () => {
    const historical: GenRecipe = {
      id: "old-shot",
      file: "src/old.gen.tsx",
      model: "kling-2.5-pro",
      prompt: "historical prompt",
      negativePrompt: "blur",
      refs: [{ kind: "image", src: "asset://historical" }],
      duration: 10,
      take: 2,
    };
    const current: GenRecipe = {
      id: "current-shot",
      file: "src/current.gen.tsx",
      prompt: "current prompt",
      take: 7,
    };

    const draft = forkGenRecipe(current, genRecipeSnapshotOf(historical), [
      { kind: "image", src: "asset://historical", contentHash: "sha256:historical" },
    ]);

    expect(draft).toMatchObject({
      id: "current-shot",
      file: "src/current.gen.tsx",
      take: 7,
      model: "kling-2.5-pro",
      prompt: "historical prompt",
      negativePrompt: "blur",
      refs: [{ kind: "image", src: "asset://historical" }],
      duration: 10,
    });
    expect(draft).not.toHaveProperty("id", historical.id);
  });

  it("forks the exact baked bytes behind a historical comp input", () => {
    const current: GenRecipe = { id: "shot", prompt: "current", take: 4 };
    const snapshot = genRecipeSnapshotOf({
      id: "shot",
      prompt: "historical",
      refs: [{ kind: "video", src: "comp://previz" }],
    });

    const draft = forkGenRecipe(current, snapshot, [
      { kind: "video", src: "comp://previz", contentHash: "sha256:exact-bake" },
    ]);

    expect(draft.refs).toEqual([
      { kind: "video", src: "/__framediff-cache/sha256%3Aexact-bake" },
    ]);
  });
});

describe("just-landed generative takes", () => {
  beforeEach(() => __generativeTest.clearPrimedTakes());

  it("keeps a job-confirmed take visible when a concurrent manifest read is stale", () => {
    const old = take(4);
    const landed = take(5);
    const staleManifest = {
      assets: {
        [old.assetId]: { contentHash: old.contentHash, bytes: old.bytes, generator: old.generator },
      },
    };

    expect(genTakesFrom(staleManifest, "shot").map((t) => t.generator.take)).toEqual([4]);
    primeGenTakes([landed]);
    expect(__generativeTest.knownGenTakes(staleManifest, "shot").map((t) => t.generator.take)).toEqual([4, 5]);
  });

  it("lets the authoritative job result replace stale data for the same take", () => {
    const stale = take(5, "sha256:stale");
    const landed = take(5, "sha256:landed");
    primeGenTakes([landed]);
    const manifest = {
      assets: {
        [stale.assetId]: { contentHash: stale.contentHash, bytes: stale.bytes, generator: stale.generator },
      },
    };

    expect(__generativeTest.knownGenTakes(manifest, "shot")[0].contentHash).toBe("sha256:landed");
  });

  it("does not paint recipe metadata over a pinned video", () => {
    primeGenTakes([take(2)]);

    const composition = generative({
      id: "shot",
      prompt: "A clean lighthouse dialogue shot",
      take: 2,
    });

    expect(composition.html).toContain('<div class="gen-slate" hidden>');
    expect(composition.html).toContain(".gen-slate[hidden] { display:none; }");
  });
});

describe("generative output contracts", () => {
  it("keeps legacy recipes readable and honors an explicit locked output", () => {
    expect(genOutputKindOf({ model: "seedream-5.0-pro" })).toBe("image");
    expect(genOutputKindOf({ model: "seedance-2.0", output: "audio" })).toBe("audio");
  });

  it("makes visual output shaping optional and presentation-only", () => {
    const recipe: GenRecipe = {
      id: "image",
      output: "image",
      model: "seedream-5.0-pro",
      prompt: "A portrait",
      aspect: "9:16",
    };
    const native = genNativeDims(recipe);
    const shaped = {
      ...recipe,
      desiredOutput: {
        width: 1920,
        height: 1080,
        fit: "cover" as const,
        crop: { x: 0.3418, y: 0, width: 0.3164, height: 1 },
      },
    };

    expect(genDims(recipe)).toEqual(native);
    expect(genDims(shaped)).toEqual({ width: 1920, height: 1080 });
    expect(recipeCanonical(shaped)).toEqual(recipeCanonical(recipe));
    expect(generative(shaped)).toMatchObject({
      width: 1920,
      height: 1080,
      durationInFrames: 1,
      meta: { output: "image" },
    });
  });

  it("hashes per-input adaptation because it changes provider input bytes", () => {
    const recipe: GenRecipe = {
      id: "video",
      output: "video",
      prompt: "Animate this",
      refs: [{
        kind: "image",
        src: "comp://portrait",
        adapt: { fit: "contain", matte: "#000000" },
      }],
    };
    expect(recipeCanonical(recipe).refs).toEqual([{
      kind: "image",
      src: "comp://portrait",
      adapt: { fit: "contain", matte: "#000000" },
    }]);
  });
});
