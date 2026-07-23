// The model registry: one entry per wired media model, each fitted to its fal endpoint's
// OpenAPI (fetched 2026-07-07 — see each def's `fitted` note). The registry drives the
// whole generative workbench: which ref kinds a model accepts, which params exist (and
// their literals in the .gen.ts), how the provider input is built, what a take costs.
//
// Seedance pricing is exact (fal token pricing); the others are estimates (`est: true`)
// until we've paid a real invoice — the UI says "est." wherever that's true.

import type { GenProvider, GenRecipe, GenRef, GenRefKind } from "./generative";

export type GenParamValue = string | number | boolean;

export interface GenParamDef {
  /** Recipe field this param reads/writes (a literal in the .gen.ts). */
  key: "tier" | "resolution" | "duration" | "aspect" | "audio" | "cfg" | "seed" | "speed" | "pitch";
  label: string;
  type: "enum" | "number";
  options?: GenParamValue[];
  min?: number;
  max?: number;
  step?: number;
  def: GenParamValue;
  /** Subset of options currently allowed (e.g. seedance fast tier caps resolution). */
  gate?: (recipe: GenRecipe) => GenParamValue[] | null;
  /** Param currently applies (e.g. kling aspect is t2v-only — i2v inherits the image). */
  enabledIf?: (recipe: GenRecipe) => boolean;
  /** Exclude from the recipe hash (e.g. seedance tier — the endpoint already encodes it).
   *  Hash-compat matters: canonical for seedance must byte-match the 52fda87 shape. */
  canonical?: false;
}

/** Where each ref kind lands in the provider input (explicit — the dev bridge injects
 *  resolved URLs into these fields; `many` appends into an array field). */
export interface GenRefField {
  kind: GenRefKind;
  field: string;
  many?: boolean;
}

export interface GenModelDef {
  /** The `model:` literal in the .gen.ts. */
  id: string;
  name: string;
  vendor: string;
  /** Credential + transport adapter used to submit and poll this model. */
  provider?: GenProvider;
  /** Media kind produced by the endpoint and pinned as a take. */
  output: "video" | "image" | "audio";
  /** Cost is an estimate (true) vs fitted to provider pricing (false). */
  est: boolean;
  /** Where the schema came from — shown in the model picker. */
  fitted: string;
  accepts: Record<GenRefKind, boolean>;
  /** Per-kind reference caps. Omitted kinds are limited only by the provider schema. */
  maxRefs?: Partial<Record<GenRefKind, number>>;
  /** Reference kinds that must be present before the recipe can be submitted. */
  requiredRefs?: GenRefKind[];
  /** Capability chips (things it can do). */
  caps: string[];
  /** Dashed chips (things it can't — ambient knowledge beats submit-time surprises). */
  limits: string[];
  negativePrompt: boolean;
  params: GenParamDef[];
  /** Drop-zone caption. */
  dropHint: string;
  /** Display mode, derived from refs. */
  modeOf(recipe: GenRecipe): string;
  /** queue.fal.run path for the recipe's current mode. */
  endpointOf(recipe: GenRecipe): string;
  /** Provider input JSON, minus ref URLs (the bridge injects those via refFieldsOf). */
  buildInput(recipe: GenRecipe): Record<string, unknown>;
  refFieldsOf(recipe: GenRecipe): GenRefField[];
  costUsd(recipe: GenRecipe): number;
  /** Output height when the model has no resolution param (else genDims uses resolution). */
  fixedHeight?: number;
  /** ≈ USD for the picker row, at the model's defaults. */
  baseline: string;
}

const dur = (r: GenRecipe, fallback: number) => r.duration ?? fallback;
const hasKind = (r: GenRecipe, k: GenRefKind) => (r.refs ?? []).some((x) => x.kind === k);

// ---------------------------------------------------------------------------
// Seedance 2.0 — the original fit (shipped 52fda87); pricing exact
// ---------------------------------------------------------------------------

const SEEDANCE_RATE_PER_1K = { standard: 0.014, fast: 0.0112 } as const;
const RES_H: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080, "4k": 2160 };
const AR: Record<string, number> = {
  "21:9": 21 / 9, "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "3:4": 3 / 4, "9:16": 9 / 16, auto: 16 / 9,
};

function dimsOf(recipe: GenRecipe, fallbackRes: string, fixedHeight?: number): { width: number; height: number } {
  const h = fixedHeight ?? RES_H[recipe.resolution ?? fallbackRes] ?? 720;
  const ar = AR[recipe.aspect ?? "16:9"] ?? 16 / 9;
  const height = ar >= 1 ? h : Math.round(h / ar / 2) * 2;
  const width = ar >= 1 ? Math.round((h * ar) / 2) * 2 : h;
  return { width, height };
}

const seedance: GenModelDef = {
  id: "seedance-2.0",
  name: "Seedance 2.0",
  vendor: "ByteDance · fal",
  output: "video",
  est: false,
  fitted: "bytedance/seedance-2.0 OpenAPI · pricing exact (fal tokens)",
  accepts: { video: true, image: true, endImage: true, audio: true },
  caps: ["video ref (r2v)", "start + end image", "audio guide", "4–15s", "480p–1080p", "opt. audio"],
  limits: ["no seed input", "no negative prompt", "likeness gate on video refs (422)"],
  negativePrompt: false,
  params: [
    // tier is canonical:false — the endpoint string already encodes it (hash-compat with 52fda87)
    { key: "tier", label: "TIER", type: "enum", options: ["fast", "standard"], def: "fast", canonical: false },
    {
      key: "resolution", label: "RES", type: "enum", options: ["480p", "720p", "1080p"], def: "720p",
      gate: (r) => ((r.tier ?? "fast") === "fast" ? ["480p", "720p"] : null),
    },
    // defs match the original GEN_DEFAULTS (duration 5, audio true) — canonical defaults
    // are load-bearing for recipes that omit the field
    { key: "duration", label: "DUR", type: "number", min: 4, max: 15, step: 1, def: 5 },
    { key: "aspect", label: "ASPECT", type: "enum", options: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], def: "16:9" },
    { key: "audio", label: "AUDIO", type: "enum", options: [true, false], def: true },
  ],
  dropHint: "video = motion ref (r2v) · image = start frame · a second image = end frame",
  modeOf(r) {
    const refs = r.refs ?? [];
    if (!refs.length) return "text-to-video";
    const starts = refs.filter((x) => x.kind === "image").length;
    const ends = refs.filter((x) => x.kind === "endImage").length;
    if (starts + ends === refs.length && starts === 1 && ends <= 1) return "image-to-video";
    return "reference-to-video";
  },
  endpointOf(r) {
    return `bytedance/seedance-2.0${(r.tier ?? "fast") === "fast" ? "/fast" : ""}/${this.modeOf(r)}`;
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      resolution: r.resolution ?? "720p",
      duration: String(dur(r, 4)),
      aspect_ratio: r.aspect ?? "16:9",
      generate_audio: r.audio ?? false,
    };
  },
  refFieldsOf(r) {
    if (this.modeOf(r) === "image-to-video") {
      return [
        { kind: "image", field: "image_url" },
        { kind: "endImage", field: "end_image_url" },
      ];
    }
    return [
      { kind: "image", field: "image_urls", many: true },
      { kind: "endImage", field: "image_urls", many: true },
      { kind: "video", field: "video_urls", many: true },
      { kind: "audio", field: "audio_urls", many: true },
    ];
  },
  costUsd(r) {
    const { width, height } = dimsOf(r, "720p");
    const tokensPerSec = (width * height * 24) / 1024;
    const rate = SEEDANCE_RATE_PER_1K[(r.tier ?? "fast") as "fast" | "standard"];
    const videoRefMult = hasKind(r, "video") ? 0.6 : 1;
    return (tokensPerSec / 1000) * rate * dur(r, 4) * videoRefMult;
  },
  baseline: "$1.21 · fast 720p 5s",
};

// ---------------------------------------------------------------------------
// Seedance 2.0 direct — ByteDance's official BytePlus ModelArk API
// ---------------------------------------------------------------------------

const BYTEPLUS_SEEDANCE_RATE_PER_1K = { standard: 0.007, fast: 0.0056 } as const;

const seedanceDirect: GenModelDef = {
  id: "seedance-2.0-direct",
  name: "Seedance 2.0 · direct",
  vendor: "ByteDance · BytePlus",
  provider: "byteplus",
  output: "video",
  est: false,
  fitted: "BytePlus ModelArk Dreamina Seedance 2.0 API · pricing exact",
  accepts: { video: true, image: true, endImage: true, audio: true },
  caps: ["official BytePlus API", "image + video + audio refs", "4–15s", "480p–720p", "opt. audio"],
  limits: ["BytePlus account + model activation required", "service unavailable in the United States", "reference media must be publicly reachable"],
  negativePrompt: false,
  params: [
    { key: "tier", label: "TIER", type: "enum", options: ["fast", "standard"], def: "fast", canonical: false },
    { key: "resolution", label: "RES", type: "enum", options: ["480p", "720p"], def: "720p" },
    { key: "duration", label: "DUR", type: "number", min: 4, max: 15, step: 1, def: 5 },
    { key: "aspect", label: "ASPECT", type: "enum", options: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], def: "16:9" },
    { key: "audio", label: "AUDIO", type: "enum", options: [true, false], def: true },
  ],
  dropHint: "official multimodal route — images, video and audio are reference materials",
  modeOf(r) {
    const refs = r.refs ?? [];
    if (!refs.length) return "text-to-video";
    const starts = refs.filter((x) => x.kind === "image").length;
    const ends = refs.filter((x) => x.kind === "endImage").length;
    if (starts === 1 && starts + ends === refs.length && ends <= 1) return "image-to-video";
    return "reference-to-video";
  },
  endpointOf(r) {
    return (r.tier ?? "fast") === "fast"
      ? "dreamina-seedance-2-0-fast-260128"
      : "dreamina-seedance-2-0-260128";
  },
  buildInput(r) {
    return {
      prompt: r.prompt
        .replace(/@Image(\d+)/gi, "Image $1")
        .replace(/@Video(\d+)/gi, "Video $1")
        .replace(/@Audio(\d+)/gi, "Audio $1"),
      resolution: r.resolution ?? "720p",
      duration: dur(r, 5),
      ratio: r.aspect ?? "16:9",
      generate_audio: r.audio ?? true,
      watermark: false,
    };
  },
  refFieldsOf() {
    // BytePlus references are structured content records, assembled by its provider
    // adapter instead of being assigned to flat fal input fields.
    return [];
  },
  costUsd(r) {
    const { width, height } = dimsOf(r, "720p");
    const tokensPerSec = (width * height * 24) / 1024;
    const rate = BYTEPLUS_SEEDANCE_RATE_PER_1K[(r.tier ?? "fast") as "fast" | "standard"];
    const videoRefMult = hasKind(r, "video") ? 0.6 : 1;
    return (tokensPerSec / 1000) * rate * dur(r, 5) * videoRefMult;
  },
  baseline: "$0.60 · fast 720p 5s",
};

// ---------------------------------------------------------------------------
// LTX 2.3 Quality audio-to-video — fal fallback for regions without BytePlus
// ---------------------------------------------------------------------------

const LTX_QUALITY_RATE_PER_MP = 0.0024075;
const LTX_NEGATIVE_PROMPT = "color distortion, overexposure, static, blurry details, subtitles, text, artwork, painting, still frame, low quality, compression artifacts, deformed face, malformed limbs, fused fingers, motionless frame";
const LTX_SIZE: Record<string, string> = {
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "1:1": "square_hd",
  "3:4": "portrait_4_3",
  "9:16": "portrait_16_9",
};

const ltx23Audio: GenModelDef = {
  id: "ltx-2.3-audio",
  name: "LTX 2.3 Quality · audio",
  vendor: "Lightricks · fal",
  output: "video",
  est: false,
  fitted: "fal-ai/ltx-2.3-quality/audio-to-video OpenAPI · pricing exact",
  accepts: { video: false, image: true, endImage: false, audio: true },
  maxRefs: { image: 1, audio: 1 },
  requiredRefs: ["audio"],
  caps: ["locked audio drives motion", "optional first frame", "audio-length output", "seed ✓", "negative prompt", "portrait + landscape"],
  limits: ["one image + one audio ref", "no separate character refs — combine characters in the keyframe", "prompt expansion pinned off"],
  negativePrompt: true,
  params: [
    // The provider derives its true output length from the audio. This field keeps the
    // composition bounds and price preview honest without pretending to control the API.
    { key: "duration", label: "AUDIO DUR", type: "number", min: 1, max: 20, step: 1, def: 5, canonical: false },
    { key: "aspect", label: "ASPECT", type: "enum", options: ["16:9", "4:3", "1:1", "3:4", "9:16"], def: "16:9" },
    { key: "audio", label: "INCLUDE AUDIO", type: "enum", options: [true, false], def: true },
    { key: "seed", label: "SEED", type: "number", min: 0, max: 2147483647, step: 1, def: 0 },
  ],
  dropHint: "required audio locks timing and performance · one optional image supplies the first frame",
  modeOf(r) {
    return hasKind(r, "image") ? "image+audio-to-video" : "audio-to-video";
  },
  endpointOf() {
    return "fal-ai/ltx-2.3-quality/audio-to-video";
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      match_audio_length: true,
      resolution: LTX_SIZE[r.aspect ?? "16:9"] ?? "auto",
      frames_per_second: 24,
      num_inference_steps: 15,
      guidance_scale: 1,
      generate_audio: r.audio ?? true,
      image_strength: 0.7,
      negative_prompt: r.negativePrompt ?? LTX_NEGATIVE_PROMPT,
      ...(r.seed ? { seed: r.seed } : {}),
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      video_quality: "high",
      video_write_mode: "balanced",
    };
  },
  refFieldsOf() {
    return [
      { kind: "image", field: "image_url" },
      { kind: "audio", field: "audio_url" },
    ];
  },
  costUsd(r) {
    const { width, height } = dimsOf(r, "720p", 720);
    const frames = Math.round(dur(r, 5) * 24) + 1;
    return (width * height * frames / 1_000_000) * LTX_QUALITY_RATE_PER_MP;
  },
  fixedHeight: 720,
  baseline: "$0.27 · 720p 5s",
};

// ---------------------------------------------------------------------------
// Veo 3.1 fast — fitted 2026-07-07; native audio; seed + negative prompt exist
// ---------------------------------------------------------------------------

const veo31: GenModelDef = {
  id: "veo-3.1-fast",
  name: "Veo 3.1 fast",
  vendor: "Google · fal",
  output: "video",
  est: true,
  fitted: "fal-ai/veo3.1/fast OpenAPI · price estimated",
  accepts: { video: false, image: true, endImage: false, audio: false },
  caps: ["start image (i2v)", "native dialogue + sfx", "seed ✓", "negative prompt", "4/6/8s", "720p–4k"],
  limits: ["no video refs", "no end frame"],
  negativePrompt: true,
  params: [
    { key: "resolution", label: "RES", type: "enum", options: ["720p", "1080p", "4k"], def: "720p" },
    { key: "duration", label: "DUR", type: "enum", options: [4, 6, 8], def: 8 },
    { key: "aspect", label: "ASPECT", type: "enum", options: ["16:9", "9:16"], def: "16:9" },
    { key: "audio", label: "AUDIO", type: "enum", options: [true, false], def: true },
    { key: "seed", label: "SEED", type: "number", min: 0, max: 2147483647, step: 1, def: 0 },
  ],
  dropHint: "images only — audio is generated natively (prompt for dialogue/sfx)",
  modeOf(r) {
    return hasKind(r, "image") ? "image-to-video" : "text-to-video";
  },
  endpointOf(r) {
    return hasKind(r, "image") ? "fal-ai/veo3.1/fast/image-to-video" : "fal-ai/veo3.1/fast";
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      resolution: r.resolution ?? "720p",
      duration: `${dur(r, 8)}s`,
      aspect_ratio: r.aspect ?? "16:9",
      generate_audio: r.audio ?? true,
      ...(r.negativePrompt ? { negative_prompt: r.negativePrompt } : {}),
      ...(r.seed ? { seed: r.seed } : {}),
    };
  },
  refFieldsOf() {
    return [{ kind: "image", field: "image_url" }];
  },
  costUsd(r) {
    const perSec = (r.audio ?? true) ? 0.15 : 0.1;
    const resMult = r.resolution === "4k" ? 2.5 : r.resolution === "1080p" ? 1.5 : 1;
    return perSec * resMult * dur(r, 8);
  },
  baseline: "est. $1.20 · 720p 8s + audio",
};

// ---------------------------------------------------------------------------
// Kling 2.5 turbo pro — fitted 2026-07-07; start + tail image, cfg, neg prompt
// ---------------------------------------------------------------------------

const kling25: GenModelDef = {
  id: "kling-2.5-pro",
  name: "Kling 2.5 turbo pro",
  vendor: "Kuaishou · fal",
  output: "video",
  est: true,
  fitted: "fal-ai/kling-video/v2.5-turbo/pro OpenAPI · price estimated",
  accepts: { video: false, image: true, endImage: true, audio: false },
  caps: ["start + end frame", "cfg 0–1", "negative prompt", "5/10s", "1080p out"],
  limits: ["no audio", "no video refs", "no seed", "aspect is t2v-only (i2v inherits the image)"],
  negativePrompt: true,
  params: [
    { key: "duration", label: "DUR", type: "enum", options: [5, 10], def: 5 },
    { key: "cfg", label: "CFG", type: "number", min: 0, max: 1, step: 0.1, def: 0.5 },
    {
      key: "aspect", label: "ASPECT", type: "enum", options: ["16:9", "9:16", "1:1"], def: "16:9",
      enabledIf: (r) => !hasKind(r, "image"),
    },
  ],
  dropHint: "two image slots — start frame, then end frame; the model interpolates",
  modeOf(r) {
    return hasKind(r, "image") ? "image-to-video" : "text-to-video";
  },
  endpointOf(r) {
    return `fal-ai/kling-video/v2.5-turbo/pro/${this.modeOf(r)}`;
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      duration: String(dur(r, 5)),
      cfg_scale: r.cfg ?? 0.5,
      negative_prompt: r.negativePrompt ?? "blur, distort, and low quality",
      ...(hasKind(r, "image") ? {} : { aspect_ratio: r.aspect ?? "16:9" }),
    };
  },
  refFieldsOf() {
    return [
      { kind: "image", field: "image_url" },
      { kind: "endImage", field: "tail_image_url" },
    ];
  },
  costUsd(r) {
    return 0.07 * dur(r, 5);
  },
  fixedHeight: 1080,
  baseline: "est. $0.35 · 5s",
};

// ---------------------------------------------------------------------------
// Wan 2.5 preview — fitted 2026-07-07; seed + an audio ref; prompt expansion OFF
// (expansion mutates the prompt server-side — non-reproducible, so we pin it off)
// ---------------------------------------------------------------------------

const wan25: GenModelDef = {
  id: "wan-2.5",
  name: "Wan 2.5 preview",
  vendor: "Alibaba · fal",
  output: "video",
  est: true,
  fitted: "fal-ai/wan-25-preview OpenAPI · price estimated",
  accepts: { video: false, image: true, endImage: false, audio: true },
  caps: ["start image", "audio ref (lip/beat sync)", "seed ✓", "negative prompt", "5/10s", "480p–1080p"],
  limits: ["no video refs", "no end frame", "prompt expansion pinned off (reproducibility)"],
  negativePrompt: true,
  params: [
    { key: "resolution", label: "RES", type: "enum", options: ["480p", "720p", "1080p"], def: "1080p" },
    { key: "duration", label: "DUR", type: "enum", options: [5, 10], def: 5 },
    {
      key: "aspect", label: "ASPECT", type: "enum", options: ["16:9", "9:16", "1:1"], def: "16:9",
      enabledIf: (r) => !hasKind(r, "image"),
    },
    { key: "seed", label: "SEED", type: "number", min: 0, max: 2147483647, step: 1, def: 0 },
  ],
  dropHint: "start image conditions it · an audio ref drives sync · seed makes takes reproducible",
  modeOf(r) {
    return hasKind(r, "image") ? "image-to-video" : "text-to-video";
  },
  endpointOf(r) {
    return `fal-ai/wan-25-preview/${this.modeOf(r)}`;
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      resolution: r.resolution ?? "1080p",
      duration: String(dur(r, 5)),
      enable_prompt_expansion: false,
      ...(hasKind(r, "image") ? {} : { aspect_ratio: r.aspect ?? "16:9" }),
      ...(r.negativePrompt ? { negative_prompt: r.negativePrompt } : {}),
      ...(r.seed ? { seed: r.seed } : {}),
    };
  },
  refFieldsOf() {
    return [
      { kind: "image", field: "image_url" },
      { kind: "audio", field: "audio_url" },
    ];
  },
  costUsd(r) {
    const perSecByRes: Record<string, number> = { "480p": 0.05, "720p": 0.1, "1080p": 0.15 };
    const perSec = perSecByRes[r.resolution ?? "1080p"] ?? 0.15;
    return perSec * dur(r, 5);
  },
  baseline: "est. $0.75 · 1080p 5s",
};

// ---------------------------------------------------------------------------

// Seedream 5.0 Pro — image generation/editing; one pinned image per take

const seedreamImageSize: Record<string, string> = {
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "1:1": "square_hd",
  "3:4": "portrait_4_3",
  "9:16": "portrait_16_9",
};

const seedream50: GenModelDef = {
  id: "seedream-5.0-pro",
  name: "Seedream 5.0 Pro",
  vendor: "ByteDance · fal",
  output: "image",
  est: false,
  fitted: "bytedance/seedream/v5/pro text + edit OpenAPI · pricing exact",
  accepts: { video: false, image: true, endImage: false, audio: false },
  caps: ["text-to-image", "up to 10 image refs", "portrait + landscape", "precise continuity edits"],
  limits: ["one pinned image per take", "no audio or video refs"],
  negativePrompt: false,
  params: [
    { key: "aspect", label: "ASPECT", type: "enum", options: ["16:9", "4:3", "1:1", "3:4", "9:16"], def: "9:16" },
  ],
  dropHint: "optional concept/style images become an edit pass; no refs becomes text-to-image",
  modeOf(r) {
    return hasKind(r, "image") ? "image-edit" : "text-to-image";
  },
  endpointOf(r) {
    return hasKind(r, "image")
      ? "bytedance/seedream/v5/pro/edit"
      : "bytedance/seedream/v5/pro/text-to-image";
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      image_size: seedreamImageSize[r.aspect ?? "9:16"] ?? "portrait_16_9",
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
    };
  },
  refFieldsOf() {
    return [{ kind: "image", field: "image_urls", many: true }];
  },
  costUsd() {
    return 0.0675;
  },
  baseline: "$0.07 · one image",
};

// Seed Audio 1.0 — cheap performance approval before any video credits are spent

const seedAudio10: GenModelDef = {
  id: "seed-audio-1.0",
  name: "Seed Audio 1.0",
  vendor: "ByteDance · fal",
  output: "audio",
  est: false,
  fitted: "bytedance/seed-audio-1.0 OpenAPI · pricing exact",
  accepts: { video: false, image: true, endImage: false, audio: true },
  caps: ["multi-speaker dialogue", "image-guided performance", "up to 3 voice refs", "mp3 output"],
  limits: ["image and audio refs cannot be combined", "duration is directed in the prompt"],
  negativePrompt: false,
  params: [
    // Timeline length controls composition bounds and cost preview, but Seed Audio takes its
    // requested performance length from the prompt rather than an API duration field.
    { key: "duration", label: "TIMELINE", type: "number", min: 4, max: 15, step: 1, def: 12, canonical: false },
    { key: "speed", label: "SPEED", type: "number", min: 0.5, max: 2, step: 0.05, def: 1 },
    { key: "pitch", label: "PITCH", type: "number", min: -12, max: 12, step: 1, def: 0 },
  ],
  dropHint: "one image can guide the performance, or up to three audio clips can guide voices",
  modeOf(r) {
    return hasKind(r, "audio") ? "reference-to-audio" : hasKind(r, "image") ? "image-to-audio" : "text-to-audio";
  },
  endpointOf() {
    return "bytedance/seed-audio-1.0";
  },
  buildInput(r) {
    return {
      prompt: r.prompt,
      output_format: "mp3",
      sample_rate: 24000,
      speed: r.speed ?? 1,
      volume: 1,
      pitch: r.pitch ?? 0,
    };
  },
  refFieldsOf(r) {
    return hasKind(r, "audio")
      ? [{ kind: "audio", field: "audio_urls", many: true }]
      : [{ kind: "image", field: "image_url" }];
  },
  costUsd(r) {
    return (0.1875 / 60) * dur(r, 12);
  },
  baseline: "$0.04 · 12s target",
};

// ---------------------------------------------------------------------------

export const GEN_MODELS: Record<string, GenModelDef> = {
  [seedance.id]: seedance,
  [seedanceDirect.id]: seedanceDirect,
  [ltx23Audio.id]: ltx23Audio,
  [veo31.id]: veo31,
  [kling25.id]: kling25,
  [wan25.id]: wan25,
  [seedream50.id]: seedream50,
  [seedAudio10.id]: seedAudio10,
};

/** Def for a recipe's model — unknown ids fall back to Seedance (the original default). */
export function genModelOf(recipe: Pick<GenRecipe, "model">): GenModelDef {
  return GEN_MODELS[recipe.model ?? "seedance-2.0"] ?? GEN_MODELS["seedance-2.0"];
}

/** Effective param value: recipe field if set, else the model default. */
export function genParamValue(recipe: GenRecipe, p: GenParamDef): GenParamValue {
  const v = (recipe as unknown as Record<string, GenParamValue | undefined>)[p.key];
  return v ?? p.def;
}

/** Ref kinds a model will take right now — used by drop targets and pickers to refuse
 *  with a reason instead of failing at submit. */
export function genRefAccept(recipe: GenRecipe, def: GenModelDef, kind: GenRefKind): { ok: boolean; why?: string } {
  if (!def.accepts[kind]) return { ok: false, why: `${def.name} takes no ${kind === "endImage" ? "end-frame" : kind} refs` };
  if (kind === "endImage" && !(recipe.refs ?? []).some((r) => r.kind === "image"))
    return { ok: false, why: "an end frame needs a start frame first" };
  const max = def.maxRefs?.[kind];
  const count = (recipe.refs ?? []).filter((ref) => ref.kind === kind).length;
  if (max != null && count >= max)
    return { ok: false, why: `${def.name} accepts at most ${max} ${kind === "endImage" ? "end-frame" : kind} ref${max === 1 ? "" : "s"}` };
  return { ok: true };
}

export type { GenRef };
