import type { AssetResolver } from "./assets/resolver";

/** Creative intent. Studio derives its normal authoring surfaces from this axis. */
export type CompositionKind = "edit" | "audio" | "doc" | "plan" | "scene" | "board" | "script" | "locations" | "cast";
/** Package-owned runtime adapter. This is deliberately separate from creative intent. */
export type CompositionType = "html" | "three" | "generative" | "processing" | "moodboard";
export const COMPOSITION_DEFINITION_VERSION = 1 as const;

/**
 * The versioned boundary shared by projects, the runtime, and Studio.
 *
 * Version 1 is latest-only: registries reject every other version. A future release can widen
 * this union and migrate older definitions inside `defineCompositionRegistry` without changing
 * project registries or package-owned Studio UI.
 */
export interface CompositionDefinitionV1 {
  version: typeof COMPOSITION_DEFINITION_VERSION;
  type: CompositionType;
  kind: CompositionKind;
}

export type CompositionDefinition = CompositionDefinitionV1;
export type CompositionOutputKind = "video" | "image" | "audio";
export type CompositionTimelineMode = "auto" | "always" | "hidden";
export type CompositionTransportMode = "auto" | "always" | "hidden";

/** Studio-facing capabilities owned by a composition. The application shell still owns global UI. */
export interface CompositionAuthoringMetadata {
  /** `auto` applies the composition kind's timeline policy to projected temporal content. */
  timeline?: CompositionTimelineMode;
  /** Preview transport is independent from a timeline (for example, a procedural 3D scene). */
  transport?: CompositionTransportMode;
  /** Selection remains available when false, but canvas gestures do not rewrite geometry or text. */
  directManipulation?: boolean;
}

export type CompositionTimelineFit = "cover" | "contain" | "fill";
export type CompositionTimelineRect = [x: number, y: number, width: number, height: number];

/**
 * Canvas placement owned by an edit document. The rectangle is in composition pixels and its
 * origin is the composition's top-left corner. `focalPoint` uses normalized 0..1 coordinates.
 */
export interface CompositionTimelineLayout {
  rect: CompositionTimelineRect;
  fit?: CompositionTimelineFit;
  focalPoint?: [x: number, y: number];
  cornerRadius?: number;
  opacity?: number;
}

export type CompositionTimelineShapeKind = "rect" | "ellipse" | "line" | "polygon" | "path";

/** Layer content owned by an edit document. `composition` is the stable registry key. */
export type CompositionTimelineContent =
  | { type: "nested"; composition: string; nestedScale?: number }
  | { type: "video"; src: string }
  | { type: "image"; src: string }
  | { type: "audio"; src: string }
  | {
      type: "shape";
      shape: CompositionTimelineShapeKind;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      /** SVG-compatible points for polygon content, in the shape's 0..100 viewBox. */
      points?: string;
      /** SVG path data for arbitrary path content, in the shape's 0..100 viewBox. */
      d?: string;
    }
  | { type: "layers"; label?: string }
  | { type: "camera"; camera: string }
  | { type: "grade-layer" };

/** Structure and timing owned by an edit document rather than by composition code. */
export interface CompositionTimelinePlacement {
  id: string;
  name?: string;
  from: number;
  durationInFrames: number;
  layer?: number;
  /** SECONDS trimmed from the head of the source media — unlike `from`/`durationInFrames`,
   *  which are frames. (nested.ts maps it as trimStartSec; a frame count here silently
   *  seeks past short clips and freezes them on their last frame.) */
  trimStart?: number;
  playbackRate?: number;
  /** Linear gain for media clips or media rendered by a nested composition. */
  volume?: number;
  /** Silence this placement without discarding its authored volume. */
  muted?: boolean;
  /** Version 2 canvas geometry. When present, this is the only spatial placement authority. */
  layout?: CompositionTimelineLayout;
  /** When present, this is a complete JSON-authored layer. Omitted for legacy HTML-backed layers. */
  content?: CompositionTimelineContent;
}

export interface CompositionTimelineDocument {
  version: 1 | 2;
  items: CompositionTimelinePlacement[];
}

/** Validate and narrow a JSON import into FrameDiff's versioned timeline document type. */
export function defineTimelineDocument(document: unknown): CompositionTimelineDocument {
  if (!document || typeof document !== "object") throw new Error("A composition timeline must be an object.");
  const candidate = document as { version?: unknown; items?: unknown };
  if (candidate.version !== 1 && candidate.version !== 2) throw new Error(`Unsupported composition timeline version: ${String(candidate.version)}`);
  if (!Array.isArray(candidate.items)) throw new Error("A composition timeline needs an items array.");
  const ids = new Set<string>();
  for (const item of candidate.items) {
    if (!item || typeof item !== "object") throw new Error("Every composition timeline item must be an object.");
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !Number.isFinite(value.from) || !Number.isFinite(value.durationInFrames)) {
      throw new Error("Every composition timeline item needs an id, from, and durationInFrames.");
    }
    if (ids.has(value.id)) throw new Error(`Timeline item id "${value.id}" is duplicated.`);
    ids.add(value.id);
    if ((value.durationInFrames as number) <= 0) throw new Error(`Timeline item ${value.id} durationInFrames must be greater than zero.`);
    if (value.layer != null && (typeof value.layer !== "number" || !Number.isInteger(value.layer) || value.layer < 0)) {
      throw new Error(`Timeline item ${value.id} layer must be a non-negative integer.`);
    }
    if (value.content != null) {
      if (typeof value.content !== "object" || typeof (value.content as Record<string, unknown>).type !== "string") {
        throw new Error(`Timeline item ${value.id} has invalid content.`);
      }
      const content = value.content as Record<string, unknown>;
      const supported = ["nested", "video", "image", "audio", "shape", "layers", "camera", "grade-layer"];
      if (!supported.includes(String(content.type))) throw new Error(`Timeline item ${value.id} has unsupported content type "${String(content.type)}".`);
      if (content.type === "nested" && typeof content.composition !== "string") throw new Error(`Nested timeline item ${value.id} needs a composition reference.`);
      if ((content.type === "video" || content.type === "image" || content.type === "audio") && typeof content.src !== "string") {
        throw new Error(`${content.type} timeline item ${value.id} needs a src.`);
      }
      if (content.type === "shape") {
        if (!["rect", "ellipse", "line", "polygon", "path"].includes(String(content.shape))) {
          throw new Error(`Shape timeline item ${value.id} needs a supported shape.`);
        }
        if (content.strokeWidth != null && (typeof content.strokeWidth !== "number" || !Number.isFinite(content.strokeWidth) || content.strokeWidth < 0)) {
          throw new Error(`Shape timeline item ${value.id} strokeWidth must be non-negative.`);
        }
        if (content.shape === "polygon" && content.points != null && typeof content.points !== "string") {
          throw new Error(`Polygon timeline item ${value.id} points must be a string.`);
        }
        if (content.shape === "path" && content.d != null && typeof content.d !== "string") {
          throw new Error(`Path timeline item ${value.id} d must be a string.`);
        }
      }
    }
    if (value.volume != null && (typeof value.volume !== "number" || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1)) {
      throw new Error(`Timeline item ${value.id} volume must be between 0 and 1.`);
    }
    if (value.muted != null && typeof value.muted !== "boolean") throw new Error(`Timeline item ${value.id} muted must be a boolean.`);
    if (value.layout != null) {
      if (candidate.version !== 2) throw new Error(`Timeline item ${value.id} layout requires timeline version 2.`);
      if (typeof value.layout !== "object" || Array.isArray(value.layout)) throw new Error(`Timeline item ${value.id} has invalid layout.`);
      const layout = value.layout as Record<string, unknown>;
      if (!Array.isArray(layout.rect) || layout.rect.length !== 4 || layout.rect.some((part) => typeof part !== "number" || !Number.isFinite(part))) {
        throw new Error(`Timeline item ${value.id} layout.rect must be [x, y, width, height].`);
      }
      if ((layout.rect[2] as number) <= 0 || (layout.rect[3] as number) <= 0) {
        throw new Error(`Timeline item ${value.id} layout width and height must be greater than zero.`);
      }
      if (layout.fit != null && !["cover", "contain", "fill"].includes(String(layout.fit))) {
        throw new Error(`Timeline item ${value.id} layout.fit must be cover, contain, or fill.`);
      }
      if (layout.focalPoint != null && (
        !Array.isArray(layout.focalPoint)
        || layout.focalPoint.length !== 2
        || layout.focalPoint.some((part) => typeof part !== "number" || !Number.isFinite(part) || part < 0 || part > 1)
      )) throw new Error(`Timeline item ${value.id} layout.focalPoint must contain two values between 0 and 1.`);
      if (layout.cornerRadius != null && (typeof layout.cornerRadius !== "number" || !Number.isFinite(layout.cornerRadius) || layout.cornerRadius < 0)) {
        throw new Error(`Timeline item ${value.id} layout.cornerRadius must be non-negative.`);
      }
      if (layout.opacity != null && (typeof layout.opacity !== "number" || !Number.isFinite(layout.opacity) || layout.opacity < 0 || layout.opacity > 1)) {
        throw new Error(`Timeline item ${value.id} layout.opacity must be between 0 and 1.`);
      }
    }
  }
  return document as CompositionTimelineDocument;
}

export interface CompositionDocumentMetadata {
  /** Project-relative JSON data file. */
  file: string;
  /** Optional project-relative JSON Schema file used for generic Inspector controls. */
  schema?: string;
  /** Stable canvas/timeline object ID to JSON Pointer base. */
  bindings?: Record<string, string>;
  /** `patch` updates the mounted comp in place; `remount` rebuilds only that comp's runtime. */
  hotUpdate?: "patch" | "remount";
  /** Optional richer Inspector treatment for a JSON-bound object. */
  inspector?: {
    kind?: "data" | "camera";
    title?: string;
    editor?: { label: string; description?: string };
  };
}

export interface CompositionMetadata {
  file?: string;
  /** Project-relative JavaScript/TypeScript module exporting this config (Studio copy/HMR). */
  module?: string;
  /** Named export in `module`. */
  exportName?: string;
  /** `generated` means HTML is assembled by JavaScript; timeline placement values are read-only. */
  sourceFormat?: "html" | "generated";
  deps?: string[];
  library?: boolean;
  render?: { from: number; to: number };
  alpha?: boolean;
  output?: CompositionOutputKind;
  outputFrame?: number;
  authoring?: CompositionAuthoringMetadata;
  /** Project-relative JSON file backing `CompositionConfig.timeline`. Included in bake inputs. */
  timelineFile?: string;
  /** Settings/spatial data consumed by code but edited independently from that code. */
  document?: CompositionDocumentMetadata;
}

export interface CompositionFrameState {
  frame: number;
  time: number;
  playing: boolean;
  gradeBypass: boolean;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export type CompositionFrameListener = (state: CompositionFrameState) => void | Promise<void>;

export interface CompositionSetupContext {
  root: HTMLElement;
  composition: CompositionConfig;
  registry: CompositionRegistry;
  resolver?: AssetResolver;
  signal: AbortSignal;
  /** Current immutable-by-convention composition data snapshot. */
  document?: unknown;
  query<T extends Element = HTMLElement>(selector: string): T | null;
  queryAll<T extends Element = HTMLElement>(selector: string): T[];
  onFrame(listener: CompositionFrameListener): () => void;
  onDocument(listener: (document: unknown) => void | Promise<void>): () => void;
  onCleanup(cleanup: () => void): void;
  resolveAsset(ref: string): Promise<string>;
}

export type CompositionSetup = (
  context: CompositionSetupContext,
) => void | (() => void) | Promise<void | (() => void)>;

/**
 * Combine reusable setup modules without making a composition own their lifecycle plumbing.
 * Setups run in declaration order; returned cleanups run in reverse order.
 */
export function combineCompositionSetups(
  ...setups: Array<CompositionSetup | null | undefined | false>
): CompositionSetup {
  return async (context) => {
    const cleanups: Array<() => void> = [];
    try {
      for (const setup of setups) {
        if (!setup) continue;
        const cleanup = await setup(context);
        if (cleanup) cleanups.push(cleanup);
      }
    } catch (error) {
      for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
      throw error;
    }
    if (!cleanups.length) return undefined;
    return () => {
      for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
    };
  };
}

/**
 * A framework-free composition. `html` is the authored HTML/CSS/JS document; `setup` is an
 * optional imported JavaScript module for code that needs module imports (WebGPU, three.js, etc.).
 * Both preview and export mount this same document and advance it through the same frame lifecycle.
 */
export interface CompositionConfig {
  definition: CompositionDefinition;
  id: string;
  html: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  setup?: CompositionSetup;
  document?: unknown;
  /** Optional external edit data. Complete JSON-authored items own structure and placement. */
  timeline?: CompositionTimelineDocument;
  meta?: CompositionMetadata;
}

export type CompositionRegistry = Record<string, CompositionConfig>;

export interface DefineCompositionOptions {
  /** Semantic authoring kind. Prefer `data-fd-kind` for portable HTML compositions. */
  kind?: CompositionKind;
  /** Runtime adapter. Ordinary authored documents default to `html`; package factories set this. */
  type?: CompositionType;
  id?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationInFrames?: number;
  setup?: CompositionSetup;
  document?: unknown;
  timeline?: CompositionTimelineDocument;
  meta?: CompositionMetadata;
  /** Project-relative source path. Prefer `data-fd-source` in the HTML for portable documents. */
  file?: string;
}

const attr = (source: string, name: string): string | undefined => {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
};

const numberAttr = (source: string, name: string): number | undefined => {
  const value = attr(source, name);
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const booleanAttr = (source: string, name: string): boolean | undefined => {
  const value = attr(source, name);
  if (value == null) return undefined;
  return value !== "false" && value !== "0";
};

function compositionTag(source: string): string {
  const match = source.match(/<[^>]+\bdata-fd-composition(?:\s|=|>)[^>]*>/i);
  if (!match) throw new Error("A composition HTML document needs one element with data-fd-composition.");
  return match[0];
}

/** Build a composition from a real HTML document. Output metadata lives on the root element. */
export function defineComposition(source: string, options: DefineCompositionOptions = {}): CompositionConfig {
  const tag = compositionTag(source);
  const id = options.id ?? attr(tag, "data-fd-id") ?? attr(tag, "id");
  const width = options.width ?? numberAttr(tag, "data-fd-width");
  const height = options.height ?? numberAttr(tag, "data-fd-height");
  const fps = options.fps ?? numberAttr(tag, "data-fd-fps");
  const durationInFrames = options.durationInFrames
    ?? numberAttr(tag, "data-fd-duration")
    ?? numberAttr(tag, "data-fd-duration-in-frames");
  if (!id) throw new Error("The data-fd-composition element needs data-fd-id (or id).");
  if (!(width && height && fps && durationInFrames)) {
    throw new Error(`Composition "${id}" needs positive data-fd-width, data-fd-height, data-fd-fps, and data-fd-duration values.`);
  }
  const kind = options.kind ?? attr(tag, "data-fd-kind");
  const kinds: readonly CompositionKind[] = ["edit", "audio", "doc", "plan", "scene", "board", "script", "locations", "cast"];
  if (!kind) throw new Error(`Composition "${id}" needs a semantic data-fd-kind.`);
  if (!kinds.includes(kind as CompositionKind)) {
    throw new Error(`Composition "${id}" has unsupported kind "${kind}". Runtime adapters belong in definition.type, not data-fd-kind.`);
  }
  const type = options.type ?? "html";
  const types: readonly CompositionType[] = ["html", "three", "generative", "processing", "moodboard"];
  if (!types.includes(type)) throw new Error(`Composition "${id}" has unsupported runtime type "${type}".`);

  const renderFrom = numberAttr(tag, "data-fd-render-from");
  const renderTo = numberAttr(tag, "data-fd-render-to");
  const timelineAttribute = attr(tag, "data-fd-timeline");
  const timeline = timelineAttribute && ["auto", "always", "hidden"].includes(timelineAttribute)
    ? timelineAttribute as CompositionTimelineMode
    : options.meta?.authoring?.timeline;
  const transportAttribute = attr(tag, "data-fd-transport");
  const transport = transportAttribute && ["auto", "always", "hidden"].includes(transportAttribute)
    ? transportAttribute as CompositionTransportMode
    : options.meta?.authoring?.transport;
  const directManipulation = booleanAttr(tag, "data-fd-direct-manipulation")
    ?? options.meta?.authoring?.directManipulation;
  const documentFile = attr(tag, "data-fd-document") ?? options.meta?.document?.file;
  const schemaFile = attr(tag, "data-fd-schema") ?? options.meta?.document?.schema;
  const meta: CompositionMetadata = {
    file: options.file ?? attr(tag, "data-fd-source") ?? options.meta?.file,
    module: attr(tag, "data-fd-module") ?? options.meta?.module,
    exportName: attr(tag, "data-fd-export") ?? options.meta?.exportName,
    sourceFormat: options.meta?.sourceFormat ?? "html",
    deps: options.meta?.deps,
    library: booleanAttr(tag, "data-fd-library") ?? options.meta?.library,
    render: renderFrom != null && renderTo != null ? { from: renderFrom, to: renderTo } : options.meta?.render,
    alpha: booleanAttr(tag, "data-fd-alpha") ?? options.meta?.alpha,
    output: (attr(tag, "data-fd-output") as CompositionOutputKind | undefined) ?? options.meta?.output,
    outputFrame: numberAttr(tag, "data-fd-output-frame") ?? options.meta?.outputFrame,
    authoring: timeline != null || transport != null || directManipulation != null
      ? { timeline, transport, directManipulation }
      : undefined,
    timelineFile: attr(tag, "data-fd-timeline-source") ?? options.meta?.timelineFile,
    document: documentFile
      ? {
          file: documentFile,
          schema: schemaFile,
          bindings: options.meta?.document?.bindings,
          hotUpdate: options.meta?.document?.hotUpdate,
          inspector: options.meta?.document?.inspector,
        }
      : undefined,
  };

  return {
    definition: { version: COMPOSITION_DEFINITION_VERSION, type, kind: kind as CompositionKind },
    id,
    html: source,
    width,
    height,
    fps,
    durationInFrames,
    setup: options.setup,
    document: options.document,
    timeline: options.timeline,
    meta,
  };
}

/**
 * Validate the complete project boundary once. This is intentionally the future migration seam:
 * version 1 rejects stale definitions; a later implementation may normalize supported old
 * versions here before returning the registry.
 */
export function defineCompositionRegistry<const T extends CompositionRegistry>(registry: T): T & CompositionRegistry {
  const ids = new Map<string, CompositionConfig>();
  for (const [key, composition] of Object.entries(registry)) {
    if (!key.trim()) throw new Error("A composition registry key cannot be empty.");
    if (!composition?.definition) throw new Error(`Composition registry entry "${key}" has no versioned definition.`);
    if (composition.definition.version !== COMPOSITION_DEFINITION_VERSION) {
      throw new Error(`Composition "${key}" uses definition version ${String(composition.definition.version)}; FrameDiff requires version ${COMPOSITION_DEFINITION_VERSION}.`);
    }
    const previous = ids.get(composition.id);
    if (previous && previous !== composition) throw new Error(`Composition id "${composition.id}" belongs to more than one definition.`);
    ids.set(composition.id, composition);
  }
  return registry;
}
