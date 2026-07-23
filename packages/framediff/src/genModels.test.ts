import { describe, expect, it } from "vitest";
import { genModelOf } from "./genModels";
import { recipeCanonical, type GenRecipe } from "./generative";

const recipe = (patch: Partial<GenRecipe>): GenRecipe => ({
  id: "test",
  prompt: "A quiet performance.",
  ...patch,
});

describe("multi-media generative models", () => {
  it("maps a Seedream portrait edit to an image take", () => {
    const value = recipe({
      model: "seedream-5.0-pro",
      aspect: "9:16",
      refs: [{ kind: "image", src: "asset://concept" }],
    });
    const model = genModelOf(value);
    expect(model.output).toBe("image");
    expect(model.endpointOf(value)).toBe("bytedance/seedream/v5/pro/edit");
    expect(model.refFieldsOf(value)).toEqual([{ kind: "image", field: "image_urls", many: true }]);
    expect(model.buildInput(value)).toMatchObject({ image_size: "portrait_16_9", num_images: 1, output_format: "jpeg" });
  });

  it("treats Seed Audio's timeline as presentation while hashing audible controls", () => {
    const value = recipe({
      model: "seed-audio-1.0",
      duration: 14,
      speed: 0.95,
      pitch: -1,
      refs: [{ kind: "image", src: "comp://portrait" }],
    });
    const model = genModelOf(value);
    expect(model.output).toBe("audio");
    expect(model.modeOf(value)).toBe("image-to-audio");
    expect(model.refFieldsOf(value)).toEqual([{ kind: "image", field: "image_url" }]);
    expect(model.buildInput(value)).toMatchObject({ output_format: "mp3", sample_rate: 24000, speed: 0.95, pitch: -1 });
    expect(recipeCanonical(value)).toMatchObject({ speed: 0.95, pitch: -1 });
    expect(recipeCanonical(value)).not.toHaveProperty("duration");
  });

  it("keeps existing video models explicitly typed as video output", () => {
    expect(genModelOf(recipe({ model: "seedance-2.0" })).output).toBe("video");
  });
});
