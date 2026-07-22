import type { AssetResolver } from "./assets/resolver";

export type CompositionKind = "edit" | "3d" | "generate" | "audio" | "doc" | "plan" | "scene" | "board" | "moodboard" | "script" | "storyboard" | "locations" | "cast";
export type CompositionOutputKind = "video" | "image";
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

/** Timing owned by an edit document rather than by the composition's HTML/TypeScript module. */
export interface CompositionTimelinePlacement {
  id: string;
  from: number;
  durationInFrames: number;
  layer?: number;
  trimStart?: number;
  playbackRate?: number;
}

export interface CompositionTimelineDocument {
  version: 1;
  items: CompositionTimelinePlacement[];
}

/** Validate and narrow a JSON import into FrameDiff's versioned timeline document type. */
export function defineTimelineDocument(document: { version: number; items: CompositionTimelinePlacement[] }): CompositionTimelineDocument {
  if (document.version !== 1) throw new Error(`Unsupported composition timeline version: ${document.version}`);
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
  kind?: CompositionKind;
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
  id: string;
  html: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  setup?: CompositionSetup;
  document?: unknown;
  /** Optional external edit data. HTML owns layer structure; this document owns placement values. */
  timeline?: CompositionTimelineDocument;
  meta?: CompositionMetadata;
}

export type CompositionRegistry = Record<string, CompositionConfig>;

export interface DefineCompositionOptions {
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
    kind: (attr(tag, "data-fd-kind") as CompositionKind | undefined) ?? options.meta?.kind,
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

  return { id, html: source, width, height, fps, durationInFrames, setup: options.setup, document: options.document, timeline: options.timeline, meta };
}
