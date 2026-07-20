import type { AssetResolver } from "./assets/resolver";

export type CompositionKind = "edit" | "3d" | "generate" | "audio" | "doc";
export type CompositionOutputKind = "video" | "image";

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
  query<T extends Element = HTMLElement>(selector: string): T | null;
  queryAll<T extends Element = HTMLElement>(selector: string): T[];
  onFrame(listener: CompositionFrameListener): () => void;
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
  };

  return { id, html: source, width, height, fps, durationInFrames, setup: options.setup, meta };
}
