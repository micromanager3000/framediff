// Shared contracts for the Studio surface: introspected timeline items, typed lanes,
// declared comp metadata, and the dev-bridge (vite plugin) endpoints.

import type { CompositionConfig, CompositionMetadata } from "../composition";
import type { StudioGuideDescriptor } from "@framediff/studio-model";

/** What a comp declares about itself beyond what introspection can see. */
export interface CompMeta extends CompositionMetadata {
  /** Coarse kind — drives the chip color/icon. Default "edit". */
  kind?: "edit" | "3d" | "generate" | "audio" | "doc" | "plan" | "scene" | "board" | "moodboard" | "script" | "storyboard" | "locations" | "cast";
  /** Project-relative HTML source file backing this comp (e.g. "src/HeroMain.html"). */
  file?: string;
  /** Extra project-relative files whose literals this comp's timing resolves through
   *  (e.g. "src/constants.ts") — also feed the bake fingerprint. */
  deps?: string[];
  /** Listed under LIBRARY in the rail (a reusable comp). */
  library?: boolean;
  /** Render window for export: output t0 is `from`, the output ends at `to` (frames on the
   *  comp's own axis). Absent = the whole comp [0, durationInFrames]. Preview and nested
   *  playback ignore it — it only trims what Render ships. */
  render?: { from: number; to: number };
  /** Composites over the base with transparency (lower-thirds etc.). */
  alpha?: boolean;
  /** Artifact kind when this comp is used as an input to generation. Defaults to video. */
  output?: "video" | "image" | "audio";
  /** Frame captured when `output` is image. Defaults to the first frame. */
  outputFrame?: number;
  /** Declared lanes that introspection can't see (text/curve/markers). */
  lanes?: DeclaredLane[];
  /** Optional first-party project walkthrough surfaced by Studio's Guide panel. */
  guide?: StudioGuideDescriptor;
  /** Optional numeric data sources that back generated timeline clips. */
  editableData?: EditableDataSource[];
}

/** A CompositionConfig extended with optional Studio metadata. */
export type StudioComposition = Omit<CompositionConfig, "meta"> & { meta?: CompMeta };

/** Registry the Studio mounts: stable composition key → composition. */
export type CompRegistry = Record<string, StudioComposition>;

export type EditableDataSource =
  | {
      type: "object-array";
      /** Project-relative file containing the exported array. */
      file: string;
      /** Exported const name, e.g. HERO_SHOTS. */
      exportName: string;
      /** String field used to match a timeline item's `name`; default "name". */
      keyField?: string;
      title?: string;
      fields: (string | { key: string; label?: string; type?: "number" | "text" })[];
    }
  | {
      /** A 3D video-plane virtual-camera move: rows follow the canonical camera field names
       *  and render as the interactive camera rig
       *  instead of raw fields. Missing fields simply don't render. */
      type: "camera3d";
      /** Project-relative file containing the exported array of move objects. */
      file: string;
      /** Exported const name, e.g. HERO_PLANE_CAMERA_MOVES. */
      exportName: string;
      /** String field used to match a timeline item's `name`; default "name". */
      keyField?: string;
      title?: string;
    }
  | {
      type: "numeric-object";
      /** Project-relative file containing the exported object. */
      file: string;
      /** Exported const name, e.g. CORNERS. */
      exportName: string;
      /** Each timeline item name indexes one numeric array property in this object. */
      title?: string;
      labels?: string[];
    };

export interface ColorGradeEffect {
  type: "color-grade";
  grade?: Record<string, number>;
  lut?: "gold" | "custom";
  lutIntensity?: number;
  /** display name for the look (e.g. "Kodak 2383", "fitted·fx3") — shown on timeline chips */
  lutName?: string;
}

export type ClipEffect = ColorGradeEffect;

// ---------------------------------------------------------------------------
// Introspected timeline model (all times in FRAMES of the owning comp)
// ---------------------------------------------------------------------------

/** One introspected placement inside a comp. */
export interface TimelineItem {
  /** Stable `data-fd-id`, or a generated fallback when the item is read-only. */
  id: string;
  /** Window start/length in the owning comp's frames. */
  from: number;
  durationInFrames: number;
  /** Optional author label (`data-fd-name`). */
  name?: string;
  /** What plays inside the window. */
  content: ItemContent;
  /** Registration order (DOM order — later elements paint on top). */
  order: number;
  /** Whether this came from a `data-fd-clip` placement (source-mappable to from/duration attributes)
   *  or a bare media/nested element (implicit full-length placement). */
  origin: "sequence" | "media";
}

export type ItemContent =
  | { type: "nested"; compId: string; trimStart: number; effects?: ClipEffect[] }
  | { type: "video"; src: string; trimStart?: number; effects?: ClipEffect[] }
  | { type: "audio"; src: string; trimStart?: number }
  | { type: "layers"; label: string; effects?: ClipEffect[] }
  /** A virtual-camera cut inside a three.js scene (`framediff/three`) — `camera` is the named rig. */
  | { type: "camera"; camera: string; effects?: ClipEffect[] }
  /** A floating `data-fd-grade-layer` — its own placement, grading everything below it. */
  | { type: "grade-layer"; effects?: ClipEffect[] };

/** Declared (non-introspectable) lanes, prototype-parity. */
export type DeclaredLane =
  | { type: "text"; label: string; doc?: string; items: { id: string; from: number; durationInFrames: number; text: string }[] }
  | { type: "curve"; label: string; param: string; min: number; max: number; keys: { t: number; v: number }[] }
  | { type: "markers"; label: string; items: { id: string; t: number; text: string }[] };

/** A fully-built lane, ready to render. */
export type Lane =
  | { type: "clips"; label: string; items: TimelineItem[] }
  | DeclaredLane
  | { type: "output"; label: string; items: OutputItem[] };

export interface OutputItem {
  id: string;
  label: string;
  state: "ok" | "stale" | "new";
  hash?: string;
}

// ---------------------------------------------------------------------------
// Dev bridge (vite plugin) — all endpoints project-root-relative, dev only
// ---------------------------------------------------------------------------
//
//   GET  /__framediff/src?file=REL          → { file, text }        read a source file
//   PUT  /__framediff/src?file=REL          body = full new text    write it back (fires HMR)
//   GET  /__framediff/cache                 → { entries: CacheEntry[], directory: string }
//   GET  /__framediff/git                   → { dirty: string[] }   `git status --porcelain`, rel paths
//   POST /__framediff/git/commit            { message } → { hash }  stage project dir + commit
//   GET/HEAD/PUT /__framediff-cache/<name>                          the HttpFolderCAS folder (as before)
//   PUT  /__out/<name>                                            save a render (as before)
//   DELETE /__out/<name>                                          remove a saved render
//   PUT  /__out-chunk/<name>?position=N                           save a render chunk by byte offset
//
//   Generative comps (keys stay server-side; Generate is the only paid action):
//   GET  /__framediff/secrets                → { providers: { fal: {set,last4,source}, … } }
//   PUT  /__framediff/secrets               { provider, key } → .framediff/secrets.json at the git root
//   GET  /__framediff/gen/verify?provider=fal → { ok, authed, error? }   authed probe, no spend
//   POST /__framediff/gen/submit            { gen, endpoint, recipeHash, input, refs, meta } → { job }
//                                          resolves asset:// refs (fal storage, data-URI fallback)
//   GET  /__framediff/gen/jobs?gen=ID        → { jobs, takes }  polls fal; finished takes land in the
//                                          CAS + framediff.assets.json with a `generator` block

export interface CacheEntry {
  /** Logical cache key (the content hash for content-addressed entries). */
  name: string;
  /** Readable filename used by the local cache folder. */
  filename?: string;
  contentHash?: string;
  size: number;
  mtimeMs: number;
  /** Parsed sidecar (<name>.meta.json) when present. */
  meta?: ArtifactMeta;
}

/** Sidecar written next to each baked artifact: enough to re-fingerprint. */
export interface ArtifactMeta {
  compId: string;
  label: string;
  /** file → content hash at bake time (comp file + deps). */
  inputs: Record<string, string>;
  createdAt: string;
}
