// Generative compositions: the generator is a comp, not a panel.
//
// A `.gen.ts` module registers executable behavior; mutable prompt/refs/params may live in an
// adjacent `.gen.json` document. `generative()` turns the merged recipe into a StudioComposition
// whose HTML plays the *pinned take*:
// a content-addressed image, audio file, or video in the configured local cache
// (`framediff-cache` by default), recorded in framediff.assets.json with a
// `generator` provenance block. Takes are the lockfile: `take: N` in source pins what ships,
// and the recipe hash drifting from the pinned take's hash is what STALE means. Nothing
// regenerates implicitly — generation happens only through the Studio's Generate action
// (the dev bridge `/__framediff/gen/*`), never at render time.

import { hashCanonical } from "./graph/hash";
import { genModelOf, genParamValue } from "./genModels";
import { cropRegionMatchesTargetAspect, normalizeCropRegion } from "@framediff/studio-model";
import type {
  CompositionOutputKind,
  VisualAdaptation,
} from "@framediff/studio-model";
import type { StudioComposition } from "./studio/types";
import { defineComposition } from "./composition";

export type GenRefKind = "image" | "endImage" | "video" | "audio";
export type GenProvider = "fal" | "byteplus" | "elevenlabs";

/** A reference input: `asset://<manifest-id>`, a `/__framediff-cache/<hash>` URL, an http(s)
 *  URL, or a data: URI. asset:// and cache refs are resolved server-side at submit time. */
export interface GenRef {
  kind: GenRefKind;
  src: string;
  /** Consumer-specific preprocessing applied before these bytes reach the selected model. */
  adapt?: VisualAdaptation;
}

export interface GenDesiredOutput extends VisualAdaptation {
  width: number;
  height: number;
}

export interface GenRecipe {
  /** Comp id — also the `gen` key takes are recorded under in framediff.assets.json. */
  id: string;
  /** Project-relative executable registration module. */
  file?: string;
  /** Project-relative JSON document containing mutable recipe settings and composition refs. */
  dataFile?: string;
  provider?: GenProvider;
  /** Immutable composition contract. Optional only so older recipes can be loaded and migrated. */
  output?: CompositionOutputKind;
  /** Model id — a key in GEN_MODELS (genModels.ts); the def drives params/refs/cost. */
  model?: string;
  tier?: "standard" | "fast";
  prompt: string;
  /** Models that expose one (Veo/Kling/Wan) — ignored by models that don't. */
  negativePrompt?: string;
  refs?: GenRef[];
  /** Output seconds. Concrete on purpose: the comp needs honest bounds. */
  duration?: number;
  resolution?: "480p" | "720p" | "1080p" | "4k";
  aspect?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  /** Ask the model for synced audio. */
  audio?: boolean;
  /** Speech rate for audio models. */
  speed?: number;
  /** Voice pitch shift in semitones for audio models. */
  pitch?: number;
  /** Voice preset or provider-specific voice id for TTS models that offer one. */
  voice?: string;
  /** Guidance strength 0–1 (Kling). */
  cfg?: number;
  /** Provider seed for reproducible or best-effort repeatable generation. */
  seed?: number;
  fps?: number;
  /** Optional post-generation visual contract. Omit to preserve the model's native shape. */
  desiredOutput?: GenDesiredOutput;
  /** Pinned take number — the lockfile. 0 = nothing pinned yet. */
  take?: number;
}

/** The reusable part of a generation recipe. Identity, source location, and the selected
 * take belong to the composition that forks the snapshot, not to the historical run. */
export type GenRecipeSnapshot = Omit<GenRecipe, "id" | "file" | "dataFile" | "take">;
export type GenRecipeData = Omit<GenRecipe, "id" | "file" | "dataFile">;

/** Durable provenance for each reference submitted to the provider. `src` is the authored
 * recipe reference; local assets and baked comps also record the exact bytes used. */
export interface GenInputProvenance {
  kind: GenRefKind;
  src: string;
  contentHash?: string;
  adapt?: VisualAdaptation;
}

/** Submission-time labels for values whose stored provider identity is not human-readable.
 * This metadata explains a historical take without changing its recipe hash or request. */
export interface GenPresentationParamSnapshot {
  key: string;
  label: string;
  value: string | number | boolean;
  displayValue: string;
  enabled: boolean;
}

export interface GenPresentationSnapshot {
  modelName: string;
  mode: string;
  costUsd: number;
  params: GenPresentationParamSnapshot[];
}

export function genRecipeSnapshotOf(recipe: GenRecipe): GenRecipeSnapshot {
  const { id: _id, file: _file, dataFile: _dataFile, take: _take, ...snapshot } = recipe;
  return snapshot;
}

/** JSON-authoritative portion of a generative recipe, including its pinned take. */
export function genRecipeDataOf(recipe: GenRecipe): GenRecipeData {
  const { id: _id, file: _file, dataFile: _dataFile, ...data } = recipe;
  return data;
}

/** Fork a historical snapshot into the current composition's editable recipe. The old take
 * and the current output pin stay untouched; baked comp refs use their exact historical bytes. */
export function forkGenRecipe(
  recipe: GenRecipe,
  snapshot: GenRecipeSnapshot,
  inputs: readonly GenInputProvenance[] = [],
): GenRecipe {
  const refs = snapshot.refs?.map((ref, index) => {
    const input = inputs[index];
    if (!ref.src.startsWith("comp://") || !input?.contentHash) return ref;
    return { ...ref, src: `/__framediff-cache/${encodeURIComponent(input.contentHash)}` };
  });
  return {
    ...snapshot,
    ...(refs ? { refs } : {}),
    id: recipe.id,
    file: recipe.file,
    dataFile: recipe.dataFile,
    take: recipe.take,
  };
}

export type GenerativeComposition = StudioComposition & { recipe: GenRecipe };

export const GEN_DEFAULTS = {
  provider: "fal",
  model: "seedance-2.0",
  tier: "fast",
  duration: 5,
  resolution: "720p",
  aspect: "16:9",
  audio: true,
  fps: 24,
  take: 0,
} as const;

export type GenMode = "text-to-video" | "image-to-video" | "reference-to-video";

/** Mode derives from the refs, per the model's rules (Seedance: video/multi-image → r2v;
 *  the others: image → i2v). */
export function genMode(recipe: GenRecipe): GenMode {
  return genModelOf(recipe).modeOf(recipe) as GenMode;
}

export function genEndpoint(recipe: GenRecipe): string {
  return genModelOf(recipe).endpointOf(recipe);
}

/** New recipes author output explicitly. Older recipes inherit it once from their model. */
export function genOutputKindOf(recipe: Pick<GenRecipe, "model" | "output">): CompositionOutputKind {
  return recipe.output ?? genModelOf(recipe).output;
}

const RES_HEIGHT = { "480p": 480, "720p": 720, "1080p": 1080, "4k": 2160 } as const;
const ASPECT: Record<NonNullable<GenRecipe["aspect"]>, number> = {
  "21:9": 21 / 9, "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "3:4": 3 / 4, "9:16": 9 / 16,
};

export function genNativeDims(recipe: GenRecipe): { width: number; height: number } {
  const def = genModelOf(recipe);
  const h = def.fixedHeight ?? RES_HEIGHT[recipe.resolution ?? GEN_DEFAULTS.resolution];
  const ar = ASPECT[recipe.aspect ?? GEN_DEFAULTS.aspect];
  // portrait aspects: the resolution names the short side, like the provider does
  const height = ar >= 1 ? h : Math.round((h / ar) / 2) * 2;
  const width = ar >= 1 ? Math.round((h * ar) / 2) * 2 : h;
  return { width, height };
}

export function genDims(recipe: GenRecipe): { width: number; height: number } {
  const native = genNativeDims(recipe);
  const desired = recipe.desiredOutput;
  if (
    genOutputKindOf(recipe) === "audio" ||
    !desired ||
    !Number.isFinite(desired.width) ||
    !Number.isFinite(desired.height) ||
    desired.width < 1 ||
    desired.height < 1
  ) return native;
  return {
    width: Math.round(desired.width),
    height: Math.round(desired.height),
  };
}

/** The exact object the recipe hash covers — what "the recipe changed" means. Excludes
 *  identity (`id`, `file`), the pin (`take` — the pin answers the hash, it isn't part of
 *  it) and presentation (`fps`). Ref srcs hash as authored (asset ids, not bytes).
 *  Model params come from the def (canonical:false params — seedance tier — are folded
 *  into the endpoint already); for seedance this byte-matches the 52fda87 shape, so
 *  existing takes keep their hashes. */
export function recipeCanonical(recipe: GenRecipe): Record<string, unknown> {
  const def = genModelOf(recipe);
  const canon: Record<string, unknown> = {
    endpoint: def.endpointOf(recipe),
    prompt: recipe.prompt,
    refs: (recipe.refs ?? []).map((r) => r.adapt
      ? { kind: r.kind, src: r.src, adapt: r.adapt }
      : { kind: r.kind, src: r.src }),
  };
  for (const p of def.params) {
    if (p.canonical === false) continue;
    canon[p.key] = genParamValue(recipe, p);
  }
  if (def.negativePrompt && recipe.negativePrompt) canon.negativePrompt = recipe.negativePrompt;
  return canon;
}

export function recipeHashOf(recipe: GenRecipe): Promise<string> {
  return hashCanonical(recipeCanonical(recipe));
}

// ---------------------------------------------------------------------------
// Takes — read from framediff.assets.json (entries carrying a `generator` block)
// ---------------------------------------------------------------------------

/** Provenance block a finished generation writes into its manifest entry. */
export interface GenProvenance {
  gen: string;
  take: number;
  recipeHash: string;
  endpoint: string;
  recipe: GenRecipeSnapshot;
  inputs: GenInputProvenance[];
  presentation?: GenPresentationSnapshot;
  requestId?: string;
  seed?: number;
  outputKind?: "video" | "image" | "audio";
  at?: string;
}

export interface GenTake {
  assetId: string;
  contentHash: string;
  bytes: number;
  mime?: string;
  generator: GenProvenance;
}

interface ManifestLike {
  assets: Record<string, { contentHash: string; bytes: number; mime?: string; generator?: GenProvenance }>;
}

export function genTakesFrom(manifest: ManifestLike | null, genId: string): GenTake[] {
  if (!manifest) return [];
  const takes: GenTake[] = [];
  for (const [assetId, e] of Object.entries(manifest.assets)) {
    if (e.generator?.gen === genId) {
      takes.push({ assetId, contentHash: e.contentHash, bytes: e.bytes, mime: e.mime, generator: e.generator });
    }
  }
  return takes.sort((a, b) => a.generator.take - b.generator.take);
}

// Takes observed from the job endpoint are newer than any independently fetched manifest.
// Keep them in a tiny session cache so the source rewrite that pins a just-landed take can
// hot-reload GenOutput without briefly (or permanently, under HTTP caching) falling back
// to the "not in cache" slate.
const primedTakes = new Map<string, GenTake>();
const takeKey = (gen: string, take: number) => `${gen}\0${take}`;

export function primeGenTakes(takes: readonly GenTake[]): void {
  for (const take of takes) primedTakes.set(takeKey(take.generator.gen, take.generator.take), take);
}

function knownGenTakes(manifest: ManifestLike | null, genId: string): GenTake[] {
  const byTake = new Map(genTakesFrom(manifest, genId).map((take) => [take.generator.take, take]));
  for (const take of primedTakes.values()) {
    if (take.generator.gen === genId) byTake.set(take.generator.take, take);
  }
  return [...byTake.values()].sort((a, b) => a.generator.take - b.generator.take);
}

const primedTake = (genId: string, take: number): GenTake | null => primedTakes.get(takeKey(genId, take)) ?? null;

// module-level manifest cache shared by every GenOutput; the Studio invalidates it by
// dispatching "framediff:gen-takes" after a take lands or the manifest changes
let manifestP: Promise<ManifestLike | null> | null = null;
function fetchManifest(): Promise<ManifestLike | null> {
  manifestP ??= fetch("/__framediff/assets", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<ManifestLike>) : null))
    .catch(() => null);
  return manifestP;
}
export function invalidateGenManifest(): void {
  manifestP = null;
}

/** Bust the manifest cache and tell every mounted GenOutput to re-resolve its pinned take.
 *  Call after a take lands or a pin changes — without this, a playing preview keeps the
 *  media element it resolved at mount time and pin edits appear to do nothing. */
export function refreshGenOutputs(): void {
  invalidateGenManifest();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("framediff:gen-takes"));
}

// ---------------------------------------------------------------------------
// Framework-free HTML output — plays the pinned take; a slate when nothing is pinned
// ---------------------------------------------------------------------------

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

export const __generativeTest = {
  clearPrimedTakes: () => primedTakes.clear(),
  knownGenTakes,
};

/**
 * Declare a generative composition. Returns a real StudioComposition — it nests, probes,
 * bakes and exports like any comp; the Studio recognizes `meta.kind === "generate"` (plus
 * the attached `recipe`) and shows the generative editor for it.
 */
export function generative(recipe: GenRecipe): GenerativeComposition {
  const outputKind = genOutputKindOf(recipe);
  const fps = recipe.fps ?? GEN_DEFAULTS.fps;
  const native = genNativeDims(recipe);
  const { width, height } = genDims(recipe);
  const durationInFrames = outputKind === "image"
    ? 1
    : Math.round((recipe.duration ?? GEN_DEFAULTS.duration) * fps);
  const prompt = escapeHtml(recipe.prompt.length > 90 ? `${recipe.prompt.slice(0, 90)}…` : recipe.prompt);
  const wantTake = recipe.take ?? GEN_DEFAULTS.take;
  const initialCandidate = primedTake(recipe.id, wantTake);
  const initial = initialCandidate?.generator.outputKind == null ||
    initialCandidate.generator.outputKind === outputKind
    ? initialCandidate
    : null;
  const initialUrl = initial ? `/__framediff-cache/${encodeURIComponent(initial.contentHash)}` : "";
  const desired = outputKind === "audio" ? undefined : recipe.desiredOutput;
  const crop = desired?.fit === "cover" && desired.crop &&
    cropRegionMatchesTargetAspect(desired.crop, native.width, native.height, width, height)
    ? normalizeCropRegion(desired.crop)
    : undefined;
  const matte = /^#[0-9a-f]{6}$/i.test(desired?.matte ?? "") ? desired?.matte : "#000000";
  const visualStyle = crop
    ? `left:${-(crop.x / crop.width) * 100}%;top:${-(crop.y / crop.height) * 100}%;width:${100 / crop.width}%;height:${100 / crop.height}%;object-fit:fill;`
    : desired?.fit === "contain"
      ? "object-fit:contain;"
      : desired?.fit === "stretch" || desired?.fit === "resize"
        ? "object-fit:fill;"
        : "object-fit:cover;";
  const media = outputKind === "video"
    ? `<video data-gen-output data-fd-type="video" data-fd-src="${initialUrl}" data-fd-muted="${!(recipe.audio ?? GEN_DEFAULTS.audio)}" style="${visualStyle}"></video>`
    : outputKind === "image"
      ? `<img data-gen-output data-fd-type="image" data-fd-src="${initialUrl}" alt="" style="${visualStyle}">`
      : `<audio data-gen-output data-fd-type="audio" data-fd-src="${initialUrl}" data-fd-volume="1"></audio>`;
  const initialStatus = wantTake > 0
    ? `take ${wantTake} not in the cache — regenerate or re-pin`
    : "no take pinned — Generate runs the recipe";
  const source = `<!doctype html><html><head><style>
    [data-fd-composition] { position:relative;overflow:hidden;background:${desired?.fit === "contain" ? matte : "linear-gradient(135deg,#191420 0%,#0e0d0b 60%,#1d1410 100%)"};color:#c6c0af;font-family:SFMono-Regular,Consolas,monospace; }
    video,img { position:absolute;inset:0;width:100%;height:100%; }
    audio { position:absolute;width:1px;height:1px;opacity:0;pointer-events:none; }
    .gen-slate { position:absolute;inset:0;display:grid;place-items:center;text-align:center;line-height:2; }
    .gen-slate[hidden] { display:none; }
    .gen-slate.audio { background:radial-gradient(circle at 50% 42%,rgba(195,165,223,.14),transparent 42%); }
    .gen-id { font-size:13px;letter-spacing:.12em;color:#c3a5df;font-weight:700; }
    .gen-prompt { font-size:10px;opacity:.8; }
    .gen-status { font-size:9px;color:#a69e8d; }
    .wave { height:48px;display:flex;align-items:center;justify-content:center;gap:5px;margin:18px 0 12px; }
    .wave i { width:4px;height:var(--h);border-radius:9px;background:#c3a5df;opacity:.75; }
  </style></head><body>
  <main data-fd-composition data-fd-id="${escapeHtml(recipe.id)}" data-fd-width="${width}" data-fd-height="${height}" data-fd-fps="${fps}" data-fd-duration="${durationInFrames}" data-fd-kind="generate" data-fd-output="${outputKind}" data-fd-library="true">
    ${media}
    <div class="gen-slate${outputKind === "audio" ? " audio" : ""}"${initial && outputKind !== "audio" ? " hidden" : ""}><div><div class="gen-id">◇ ${escapeHtml(recipe.id)} · ${outputKind}</div>${outputKind === "audio" ? '<div class="wave"><i style="--h:16px"></i><i style="--h:31px"></i><i style="--h:44px"></i><i style="--h:25px"></i><i style="--h:38px"></i><i style="--h:20px"></i><i style="--h:34px"></i><i style="--h:14px"></i></div>' : ""}<div class="gen-prompt">“${prompt}”</div><div class="gen-status">${initial && outputKind === "audio" ? `take ${wantTake} pinned · audio-first performance` : initialStatus}</div></div></div>
  </main></body></html>`;
  const composition = defineComposition(source, {
    meta: { kind: "generate", output: outputKind, file: recipe.file, module: recipe.file, sourceFormat: "generated", library: true, deps: recipe.dataFile ? [recipe.dataFile] : undefined },
    setup: ({ query, onCleanup, signal }) => {
      const output = query<HTMLMediaElement | HTMLImageElement>("[data-gen-output]")!;
      const slate = query<HTMLElement>(".gen-slate")!;
      const status = query<HTMLElement>(".gen-status")!;
      const load = async () => {
        const immediate = primedTake(recipe.id, wantTake);
        const takes = immediate ? [immediate] : knownGenTakes(await fetchManifest(), recipe.id);
        if (signal.aborted) return;
        const pinned = takes.find((take) =>
          take.generator.take === wantTake &&
          (take.generator.outputKind == null || take.generator.outputKind === outputKind)
        ) ?? null;
        slate.hidden = outputKind === "audio" ? false : !!pinned;
        if (pinned) {
          const url = `/__framediff-cache/${encodeURIComponent(pinned.contentHash)}`;
          // Same-src refreshes must not restart a playing media element.
          if (output.getAttribute("src") !== url) {
            (output as HTMLElement).dataset.fdSrc = url;
            output.setAttribute("src", url);
          }
          if (outputKind === "audio") status.textContent = `take ${wantTake} pinned · audio-first performance`;
        } else {
          output.removeAttribute("src");
          status.textContent = initialStatus;
        }
      };
      void load();
      window.addEventListener("framediff:gen-takes", load);
      onCleanup(() => window.removeEventListener("framediff:gen-takes", load));
    },
  });
  return { ...composition, recipe };
}
