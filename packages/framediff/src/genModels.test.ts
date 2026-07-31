import { describe, expect, it } from "vitest";
import { genModelOf, genModelsForOutput, genRefAccept } from "./genModels";
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

  it("preserves zero as a valid deterministic seed for ElevenLabs", () => {
    const direct = recipe({
      output: "audio",
      model: "elevenlabs-direct",
      voice: "voice-123",
      seed: 0,
    });
    const directModel = genModelOf(direct);
    expect(directModel.buildInput(direct)).toMatchObject({ seed: 0 });

    const design = recipe({
      output: "audio",
      model: "elevenlabs-voice-design",
      seed: 0,
    });
    const designModel = genModelOf(design);
    expect(designModel.buildInput(design)).toMatchObject({ seed: 0 });
    expect(designModel.params.find((param) => param.key === "seed")).toMatchObject({
      min: 0,
      max: 2147483647,
    });
  });

  it("keeps existing video models explicitly typed as video output", () => {
    expect(genModelOf(recipe({ model: "seedance-2.0" })).output).toBe("video");
  });

  it("filters models only by locked media type, never by dimensions", () => {
    const videoModels = genModelsForOutput("video");
    expect(videoModels.length).toBeGreaterThan(3);
    expect(videoModels.every((model) => model.output === "video")).toBe(true);
    expect(genModelsForOutput("image").map((model) => model.id)).toContain("seedream-5.0-pro");
    expect(genModelsForOutput("audio").map((model) => model.id)).toContain("seed-audio-1.0");
  });

  it("uses the locked output's safe default when a stored model is incompatible", () => {
    expect(genModelOf({ output: "image", model: "seedance-2.0" }).id).toBe("seedream-5.0-pro");
    expect(genModelOf({ output: "audio", model: "seedance-2.0" }).id).toBe("seed-audio-1.0");
  });

  it("maps direct Seedance to the official BytePlus multimodal task", () => {
    const value = recipe({
      provider: "byteplus",
      model: "seedance-2.0-direct",
      tier: "standard",
      resolution: "720p",
      duration: 14,
      aspect: "9:16",
      audio: true,
      prompt: "@Image1 and @Image2 perform to @Audio1.",
      refs: [
        { kind: "image", src: "comp://visitor" },
        { kind: "image", src: "comp://keeper" },
        { kind: "audio", src: "comp://dialogue" },
      ],
    });
    const model = genModelOf(value);
    expect(model.provider).toBe("byteplus");
    expect(model.modeOf(value)).toBe("reference-to-video");
    expect(model.endpointOf(value)).toBe("dreamina-seedance-2-0-260128");
    expect(model.refFieldsOf(value)).toEqual([]);
    expect(model.buildInput(value)).toMatchObject({
      prompt: "Image 1 and Image 2 perform to Audio 1.",
      duration: 14,
      ratio: "9:16",
      generate_audio: true,
      watermark: false,
    });
  });

  it("maps locked audio and one keyframe into LTX audio-to-video", () => {
    const value = recipe({
      model: "ltx-2.3-audio",
      duration: 14,
      aspect: "9:16",
      audio: true,
      seed: 42,
      refs: [
        { kind: "image", src: "comp://combined-keyframe" },
        { kind: "audio", src: "comp://dialogue" },
      ],
    });
    const model = genModelOf(value);
    expect(model.provider).toBeUndefined();
    expect(model.modeOf(value)).toBe("image+audio-to-video");
    expect(model.endpointOf(value)).toBe("fal-ai/ltx-2.3-quality/audio-to-video");
    expect(model.requiredRefs).toEqual(["audio"]);
    expect(model.maxRefs).toMatchObject({ image: 1, audio: 1 });
    expect(model.refFieldsOf(value)).toEqual([
      { kind: "image", field: "image_url" },
      { kind: "audio", field: "audio_url" },
    ]);
    expect(model.buildInput(value)).toMatchObject({
      match_audio_length: true,
      resolution: "portrait_16_9",
      frames_per_second: 24,
      generate_audio: true,
      seed: 42,
      enable_prompt_expansion: false,
    });
    expect(model.costUsd(value)).toBeCloseTo(0.7477, 3);
    expect(recipeCanonical(value)).not.toHaveProperty("duration");
  });

  it("refuses duplicate LTX inputs before the provider can silently overwrite them", () => {
    const value = recipe({
      model: "ltx-2.3-audio",
      refs: [
        { kind: "image", src: "comp://keyframe" },
        { kind: "audio", src: "comp://dialogue" },
      ],
    });
    const model = genModelOf(value);
    expect(genRefAccept(value, model, "image")).toMatchObject({ ok: false });
    expect(genRefAccept(value, model, "audio")).toMatchObject({ ok: false });
    expect(genRefAccept(value, model, "video")).toMatchObject({ ok: false });
  });
});
