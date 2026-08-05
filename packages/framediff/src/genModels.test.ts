import { describe, expect, it } from "vitest";
import { genModelOf, genModelsForOutput, genNumericParamValidationError, genRefAccept } from "./genModels";
import { recipeCanonical, recipeHashOf, type GenRecipe } from "./generative";

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

  it("sends and hashes supported ElevenLabs Direct speed while rejecting unsupported values", async () => {
    const normal = recipe({
      output: "audio",
      model: "elevenlabs-direct",
      voice: "voice-123",
      speed: 1,
    });
    const faster = { ...normal, speed: 1.2 };
    const unsupported = { ...normal, speed: 1.5 };
    const model = genModelOf(normal);

    expect(model.buildInput(normal)).toMatchObject({ voice_settings: { speed: 1 } });
    expect(model.buildInput(faster)).toMatchObject({ voice_settings: { speed: 1.2 } });
    await expect(recipeHashOf(faster)).resolves.not.toBe(await recipeHashOf(normal));
    expect(genNumericParamValidationError(normal, model)).toBeUndefined();
    expect(genNumericParamValidationError(faster, model)).toBeUndefined();
    expect(genNumericParamValidationError(unsupported, model)).toBe(
      "SPEED for Eleven v3 · direct must be between 0.7 and 1.2; received 1.5.",
    );
  });

  it("accepts one audio composition as a direct ElevenLabs voice anchor", () => {
    const direct = recipe({
      output: "audio",
      model: "elevenlabs-direct",
      refs: [{ kind: "audio", src: "comp://voiceRef" }],
    });
    const model = genModelOf(direct);

    expect(genRefAccept({ ...direct, refs: [] }, model, "audio")).toMatchObject({ ok: true });
    expect(model.modeOf(direct)).toBe("anchored-text-to-audio");
    expect(model.refFieldsOf(direct)).toEqual([]);

    const multilingual = recipe({
      output: "audio",
      model: "elevenlabs-multilingual-v2",
      refs: [{ kind: "audio", src: "comp://voiceRef" }],
    });
    const multilingualModel = genModelOf(multilingual);
    expect(genRefAccept({ ...multilingual, refs: [] }, multilingualModel, "audio")).toMatchObject({ ok: true });
    expect(multilingualModel.modeOf(multilingual)).toBe("anchored-text-to-audio");
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

  it("maps an H3 keyframe pair to image-to-video with provider-cased resolution", () => {
    const value = recipe({
      model: "minimax-h3",
      resolution: "2k",
      duration: 8,
      aspect: "9:16",
      refs: [
        { kind: "image", src: "comp://start" },
        { kind: "endImage", src: "comp://end" },
      ],
    });
    const model = genModelOf(value);
    expect(model.modeOf(value)).toBe("image-to-video");
    expect(model.endpointOf(value)).toBe("minimax/h3/image-to-video");
    expect(model.refFieldsOf(value)).toEqual([
      { kind: "image", field: "image_url" },
      { kind: "endImage", field: "end_image_url" },
    ]);
    const input = model.buildInput(value);
    expect(input).toMatchObject({ resolution: "2K", duration: 8 });
    // i2v output follows the start image — the endpoint takes no aspect field
    expect(input).not.toHaveProperty("aspect_ratio");
    expect(model.params.find((p) => p.key === "aspect")?.enabledIf?.(value)).toBe(false);
    expect(model.costUsd(value)).toBeCloseTo(0.26 * 8, 5);
  });

  it("spells out H3 reference mentions and charges for images beyond the free five", () => {
    const value = recipe({
      model: "minimax-h3",
      duration: 5,
      prompt: "@Image1 walks past @Video1 humming @Audio1.",
      refs: [
        ...Array.from({ length: 7 }, (_, i) => ({ kind: "image" as const, src: `comp://ref${i}` })),
        { kind: "video", src: "comp://motion" },
        { kind: "audio", src: "comp://hum" },
      ],
    });
    const model = genModelOf(value);
    expect(model.modeOf(value)).toBe("reference-to-video");
    expect(model.endpointOf(value)).toBe("minimax/h3/reference-to-video");
    expect(model.refFieldsOf(value)).toEqual([
      { kind: "image", field: "reference_image_urls", many: true },
      { kind: "endImage", field: "reference_image_urls", many: true },
      { kind: "video", field: "reference_video_urls", many: true },
      { kind: "audio", field: "reference_audio_urls", many: true },
    ]);
    expect(model.buildInput(value)).toMatchObject({
      prompt: "Image 1 walks past Video 1 humming Audio 1.",
      resolution: "768P",
      aspect_ratio: "16:9",
    });
    // 5s at $0.16/s plus two reference images past the free five at $0.08 each
    expect(model.costUsd(value)).toBeCloseTo(0.16 * 5 + 2 * 0.08, 5);
  });

  it("keeps Seedance 2.5 on the 2.0 wire shape without a tier suffix", async () => {
    const t2v = recipe({ model: "seedance-2.5", resolution: "1080p", duration: 10, aspect: "21:9", audio: false });
    const model = genModelOf(t2v);
    expect(model.endpointOf(t2v)).toBe("bytedance/seedance-2.5/text-to-video");
    expect(model.buildInput(t2v)).toMatchObject({
      resolution: "1080p",
      duration: "10",
      aspect_ratio: "21:9",
      generate_audio: false,
    });

    const r2v = {
      ...t2v,
      refs: [
        { kind: "image" as const, src: "comp://subject" },
        { kind: "video" as const, src: "comp://motion" },
      ],
    };
    expect(model.modeOf(r2v)).toBe("reference-to-video");
    expect(model.endpointOf(r2v)).toBe("bytedance/seedance-2.5/reference-to-video");
    expect(model.refFieldsOf(r2v)).toEqual([
      { kind: "image", field: "image_urls", many: true },
      { kind: "endImage", field: "image_urls", many: true },
      { kind: "video", field: "video_urls", many: true },
      { kind: "audio", field: "audio_urls", many: true },
    ]);
    // the endpoint changes with the refs, so the hash must move too
    await expect(recipeHashOf(r2v)).resolves.not.toBe(await recipeHashOf(t2v));
  });

  it("folds the FLUX 3 draft tier into the endpoint and gates draft resolution", () => {
    const draft = recipe({ model: "flux-3", duration: 12 });
    const model = genModelOf(draft);
    expect(model.endpointOf(draft)).toBe("blackforestlabs/flux-3/text-to-video/draft");
    const draftInput = model.buildInput(draft);
    expect(draftInput).toMatchObject({ duration: 12, safety_tolerance: 2, generate_audio: true });
    // draft endpoints render 720p only and take no resolution field
    expect(draftInput).not.toHaveProperty("resolution");
    const resolutionParam = model.params.find((p) => p.key === "resolution");
    expect(resolutionParam?.gate?.(draft)).toEqual(["720p"]);
    expect(model.params.find((p) => p.key === "tier")?.canonical).toBe(false);
    expect(model.costUsd(draft)).toBeCloseTo(0.06 * 12, 5);

    const full = recipe({ model: "flux-3", tier: "standard", resolution: "1080p", duration: 12 });
    expect(model.endpointOf(full)).toBe("blackforestlabs/flux-3/text-to-video");
    expect(model.buildInput(full)).toMatchObject({ resolution: "1080p" });
    expect(resolutionParam?.gate?.(full)).toBeNull();
    expect(model.costUsd(full)).toBeCloseTo(0.29 * 12, 5);
  });

  it("routes a FLUX 3 start + end pair through first-last-frame endpoints", () => {
    const value = recipe({
      model: "flux-3",
      tier: "standard",
      refs: [
        { kind: "image", src: "comp://start" },
        { kind: "endImage", src: "comp://end" },
      ],
    });
    const model = genModelOf(value);
    expect(model.modeOf(value)).toBe("first-last-frame-to-video");
    expect(model.endpointOf(value)).toBe("blackforestlabs/flux-3/first-last-frame-to-video");
    expect(model.refFieldsOf(value)).toEqual([
      { kind: "image", field: "start_image_url" },
      { kind: "endImage", field: "end_image_url" },
    ]);
    const startOnly = { ...value, refs: value.refs!.slice(0, 1) };
    expect(model.endpointOf(startOnly)).toBe("blackforestlabs/flux-3/image-to-video");
    expect(model.refFieldsOf(startOnly)).toEqual([{ kind: "image", field: "image_url" }]);
  });

  it("maps direct FLUX 3 onto BFL's discriminated endpoint with hd/fhd classes", () => {
    const t2v = recipe({ model: "flux-3-direct", resolution: "1080p", duration: 6, aspect: "9:16" });
    const model = genModelOf(t2v);
    expect(model.provider).toBe("bfl");
    expect(model.endpointOf(t2v)).toBe("v1/flux-3-video");
    expect(model.buildInput(t2v)).toMatchObject({
      mode: "t2v",
      resolution: "fhd",
      duration: 6,
      aspect_ratio: "9:16",
      draft: false,
    });

    const i2v = { ...t2v, resolution: "720p" as const, refs: [{ kind: "image" as const, src: "comp://start" }] };
    expect(model.buildInput(i2v)).toMatchObject({ mode: "i2v", resolution: "hd" });
    // keyframes are positional — the bfl adapter assembles them, not a named field
    expect(model.refFieldsOf(i2v)).toEqual([]);
  });
});
