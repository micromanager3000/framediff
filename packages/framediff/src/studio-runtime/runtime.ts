import type {
  AnimationCreateRequest,
  AnimationEditRequest,
  AnimationProbeSnapshot,
  AgentFrameSnapshot,
  CompositionDescriptor,
  CompositionOutputKind,
  CompositionRuntimePort,
  InspectorDetailsSnapshot,
  InspectorFieldEditRequest,
  InspectorFieldsEditRequest,
  InspectorFieldSnapshot,
  InspectorSectionSnapshot,
  MotionPathCreateRequest,
  MotionPathEditRequest,
  GenerativeWorkspaceSnapshot,
  NewCompositionRequest,
  ProjectEditListener,
  ProjectEditReceipt,
  ProjectEditResult,
  ProjectOperationResult,
  PlacementEditRequest,
  PlacementEditResult,
  PreviewElementEditRequest,
  PreviewHandle,
  PreviewNodeSnapshot,
  PreviewOptions,
  RenderProgressSnapshot,
  RenderResult,
  TimelineItemSnapshot,
  UnrollGroupRequest,
} from "@framediff/studio-model";
import { artifactStatusFromInputs, buildTimelineLanes } from "@framediff/studio-model";
import { createAssetResolver, type AssetResolver } from "../assets/resolver";
import { HttpFolderCAS } from "../assets/httpCas";
import type { AssetManifest } from "../graph/schemas";
import {
  parseNumericArrayProperty,
  parseObjectArray,
  parseObjectArrayStrings,
  rewriteLiteral,
  rewriteStringLiteral,
  insertRegistryEntry,
  relModule,
  removeRegistryEntry,
  type FileSet,
  type LiteralLoc,
  type ResolvedExpr,
  type StringLiteralLoc,
} from "../studio/sourceMap";
import {
  applySourceEdit,
  deleteSource,
  getAssets,
  genJobs,
  genSubmit,
  getSecrets,
  gitCommit,
  gitDirty,
  listCache,
  putSecret,
  readSource,
  readSourceRevision,
  uploadAsset as uploadAssetThroughBridge,
  verifyProvider,
  writeArtifactMeta,
  writeSource,
} from "../studio/devfs";
import type { CacheEntry, CompRegistry, StudioComposition } from "../studio/types";
import { CAMERA3D_FIELD_KEYS } from "../studio/editableData";
import { exportVideo } from "../render/exportVideo";
import { captureCompositeFrame } from "../render/captureComposite";
import { downloadBuffer } from "../save";
import { hashBlob, hashString } from "../graph/hash";
import { camelName, kebabName, pascalName } from "../studio/compose";
import { remapRecipeForModel, rewriteRecipeSource, withRecipe } from "../studio/genSource";
import { GEN_MODELS, genModelOf, genParamValue } from "../genModels";
import {
  genRecipeSnapshotOf,
  invalidateGenManifest,
  primeGenTakes,
  recipeHashOf,
  forkGenRecipe,
  type GenRecipe,
  type GenRef,
  type GenerativeComposition,
} from "../generative";
import { mountComposition, type CompositionHandle } from "../runtime";
import { analyzeGsapSource, analyzeGsapUnrollGroups, insertGsapTweenSource, rewriteGsapAnimationSource, rewriteGsapMotionPathSource, rewriteGsapUnrollSource } from "../gsap/source";
import { parseMotionPathSvg } from "@framediff/studio-model";
import { getGsapRuntimeTraces } from "../gsap";
import {
  htmlGradeAttributes,
  inspectorFieldsFromHtml,
  insertNestedHtmlComposition,
  removeHtmlAttribute,
  rewriteHtmlAttribute,
  rewriteHtmlAttributes,
  timelineFromHtml,
} from "../studio/htmlSource";
import "./preview.css";

type PreviewRecord = {
  host: HTMLElement;
  compositionKey: string;
  options: PreviewOptions;
  mountedKey?: string;
  swapRevision: number;
  handle?: CompositionHandle;
  observer?: ResizeObserver;
  stage?: HTMLElement;
  nodeListeners: Set<(nodes: PreviewNodeSnapshot[]) => void>;
  draftIds: Set<string>;
  draftStyles: Map<string, { transform: string; width: string; height: string }>;
};

const previewNumeric = (element: Element, name: string, fallback: number): number => {
  const value = Number(element.getAttribute(name));
  return element.hasAttribute(name) && Number.isFinite(value) ? value : fallback;
};

function previewText(element: HTMLElement): string | undefined {
  if (element.hasAttribute("data-fd-text")) return element.getAttribute("data-fd-text") ?? "";
  if (element.getAttribute("data-fd-text-authority") === "computed" || element.childElementCount) return undefined;
  const text = element.textContent?.trim();
  return text || undefined;
}

function previewElement(preview: PreviewRecord, element: HTMLElement): PreviewNodeSnapshot | null {
  const root = preview.handle?.root;
  const objectId = element.getAttribute("data-fd-id");
  if (!root || !objectId || element === root || element.closest("[data-fd-composition]") !== root) return null;
  const hostBounds = preview.host.getBoundingClientRect();
  const rootBounds = root.getBoundingClientRect();
  const scaleX = root.offsetWidth ? rootBounds.width / root.offsetWidth : 1;
  const scaleY = root.offsetHeight ? rootBounds.height / root.offsetHeight : 1;
  const rotation = previewNumeric(element, "data-fd-rotation", 0);
  const elementScale = previewNumeric(element, "data-fd-scale", 1);
  const radians = rotation * Math.PI / 180;
  const width = previewNumeric(element, "data-fd-width", element.offsetWidth);
  const height = previewNumeric(element, "data-fd-height", element.offsetHeight);
  const visual = element.getBoundingClientRect();
  // Measure the element's coordinate space from its container, so ancestor transforms
  // (a zoomed board camera) are part of the composition→preview axis, not just the
  // frame's preview scale. Falls back to the root scale for zero-size containers.
  const container = element.parentElement;
  const containerBounds = container?.getBoundingClientRect();
  const axisX = container?.offsetWidth && containerBounds ? containerBounds.width / container.offsetWidth : scaleX;
  const axisY = container?.offsetHeight && containerBounds ? containerBounds.height / container.offsetHeight : scaleY;
  const previewWidth = width * axisX * elementScale;
  const previewHeight = height * axisY * elementScale;
  const owner = element.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  const parent = element.parentElement?.closest<HTMLElement>("[data-fd-id]");
  const compRef = element.getAttribute("data-fd-comp");
  const text = previewText(element);
  return {
    ref: { compositionKey: preview.compositionKey, objectId, kind: "element" },
    tagName: element.tagName.toLowerCase(),
    label: element.getAttribute("data-fd-name") ?? objectId,
    ...(parent && parent !== root ? { parentId: parent.getAttribute("data-fd-id") ?? undefined } : {}),
    ...(owner?.getAttribute("data-fd-id") ? { ownerItemId: owner.getAttribute("data-fd-id")! } : {}),
    ...(compRef ? { nestedCompositionKey: compRef } : {}),
    bounds: {
      x: element.offsetLeft + previewNumeric(element, "data-fd-x", 0),
      y: element.offsetTop + previewNumeric(element, "data-fd-y", 0),
      width,
      height,
    },
    previewBounds: {
      x: visual.left + visual.width / 2 - previewWidth / 2 - hostBounds.left,
      y: visual.top + visual.height / 2 - previewHeight / 2 - hostBounds.top,
      width: previewWidth,
      height: previewHeight,
    },
    compositionToPreview: {
      a: axisX,
      b: 0,
      c: 0,
      d: axisY,
      e: rootBounds.left - hostBounds.left,
      f: rootBounds.top - hostBounds.top,
    },
    localToPreview: {
      a: Math.cos(radians) * axisX * elementScale,
      b: Math.sin(radians) * axisY * elementScale,
      c: -Math.sin(radians) * axisX * elementScale,
      d: Math.cos(radians) * axisY * elementScale,
      e: 0,
      f: 0,
    },
    properties: {
      x: previewNumeric(element, "data-fd-x", 0),
      y: previewNumeric(element, "data-fd-y", 0),
      width,
      height,
      rotation,
      scale: elementScale,
    },
    ...(text != null ? { text } : {}),
    movable: element.hasAttribute("data-fd-x") || element.hasAttribute("data-fd-y"),
    resizable: element.hasAttribute("data-fd-width") || element.hasAttribute("data-fd-height"),
  };
}

function previewNodes(preview: PreviewRecord): PreviewNodeSnapshot[] {
  const root = preview.handle?.root;
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>("[data-fd-id]"))
    .map((element) => previewElement(preview, element))
    .filter((node): node is PreviewNodeSnapshot => node != null);
}

function emitPreviewNodes(preview: PreviewRecord): void {
  if (!preview.nodeListeners.size) return;
  const nodes = previewNodes(preview);
  for (const listener of preview.nodeListeners) listener(nodes);
}

function draftPreviewElement(preview: PreviewRecord, objectId: string, patch: PreviewElementEditRequest["patch"]): void {
  const element = Array.from(preview.handle?.root.querySelectorAll<HTMLElement>("[data-fd-id]") ?? [])
    .find((candidate) => candidate.getAttribute("data-fd-id") === objectId);
  if (!element) return;
  if (!preview.draftStyles.has(objectId)) {
    preview.draftStyles.set(objectId, {
      transform: element.style.transform,
      width: element.style.width,
      height: element.style.height,
    });
  }
  const x = patch.x ?? previewNumeric(element, "data-fd-x", 0);
  const y = patch.y ?? previewNumeric(element, "data-fd-y", 0);
  const scale = previewNumeric(element, "data-fd-scale", 1);
  const rotation = previewNumeric(element, "data-fd-rotation", 0);
  element.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
  if (patch.width != null) element.style.width = `${patch.width}px`;
  if (patch.height != null) element.style.height = `${patch.height}px`;
  preview.draftIds.add(objectId);
  emitPreviewNodes(preview);
}

function clearPreviewDraft(preview: PreviewRecord, objectId?: string): void {
  const ids = objectId ? [objectId] : [...preview.draftIds];
  for (const id of ids) {
    const element = Array.from(preview.handle?.root.querySelectorAll<HTMLElement>("[data-fd-id]") ?? [])
      .find((candidate) => candidate.getAttribute("data-fd-id") === id);
    const original = preview.draftStyles.get(id);
    if (element && original) {
      element.style.transform = original.transform;
      element.style.width = original.width;
      element.style.height = original.height;
    }
    preview.draftIds.delete(id);
    preview.draftStyles.delete(id);
  }
  emitPreviewNodes(preview);
}

const GRADE_PRESETS: Record<string, { label: string; values: Record<string, number> }> = {
  neutral: { label: "Neutral", values: { exposure: 0, contrast: 0, saturation: 1, temperature: 0, vignette: 0 } },
  "kodak-2383": { label: "Kodak 2383", values: { temperature: 0.18, contrast: 0.14, saturation: 1.08, vignette: 0.24 } },
  "portra-400": { label: "Portra 400", values: { temperature: 0.24, tint: 0.03, contrast: 0.08, saturation: 1.16, vignette: 0.14 } },
  "teal-orange": { label: "Teal & Orange", values: { temperature: -0.35, tint: 0.05, contrast: 0.12, saturation: 1.15, vignette: 0.42 } },
  moonlit: { label: "Moonlit", values: { exposure: -0.12, temperature: -0.28, contrast: 0.18, saturation: 0.82, vignette: 0.36 } },
};

function htmlCompositionScaffold(options: {
  id: string;
  exportName: string;
  file: string;
  module: string;
  kind: NewCompositionRequest["kind"];
  width: number;
  height: number;
  fps: number;
  duration: number;
}): string {
  if (options.kind === "plan") return planCompositionScaffold(options);
  const webGpu = options.kind === "3d" ? `
    <canvas data-fd-id="scene" data-fd-name="Scene" data-fd-type="layers" data-fd-webgpu
      data-fd-prop-intensity="1" data-fd-prop-intensity-label="Intensity"></canvas>` : "";
  const content = options.kind === "audio"
    ? `\n    <audio data-fd-id="audio" data-fd-type="audio" data-fd-src="/audio.mp3" data-fd-volume="1"></audio>`
    : webGpu || `\n    <section data-fd-clip data-fd-id="title" data-fd-name="Title" data-fd-from="0" data-fd-duration="${options.duration}" data-fd-opacity="1">
      <h1 data-fd-id="title-text" data-fd-text="${options.id}"></h1>
    </section>`;
  return `<!doctype html>
<html>
<head>
  <style>
    [data-fd-composition] { position: relative; overflow: hidden; background: #111; color: white; font-family: system-ui, sans-serif; }
    [data-fd-clip] { position: absolute; inset: 0; display: grid; place-items: center; }
    h1 { font-size: 96px; margin: 0; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <main data-fd-composition data-fd-id="${options.id}"
    data-fd-width="${options.width}" data-fd-height="${options.height}"
    data-fd-fps="${options.fps}" data-fd-duration="${options.duration}"
    data-fd-kind="${options.kind}" data-fd-source="${options.file}"
    data-fd-module="${options.module}" data-fd-export="${options.exportName}">${content}
    <script>
      // Plain JavaScript frame lifecycle. Imported modules can also be supplied as setup
      // in ${options.module} (use that for WebGPU, WebGL, or third-party libraries).
      onFrame(({ frame, time }) => {
        root.style.setProperty("--frame", frame);
        root.style.setProperty("--time", time);
      });
    </script>
  </main>
</body>
</html>
`;
}

/**
 * Plan comps hold intent as timed rows (script scenes, rundown segments, shot-list
 * shots). Rows are ordinary clips, so the document is scrubbable, its timing edits in
 * the timeline, and generateEditSkeleton() can derive a master from it.
 */
function planCompositionScaffold(options: {
  id: string;
  exportName: string;
  file: string;
  module: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
}): string {
  const third = Math.max(1, Math.round(options.duration / 3));
  const rows = [
    { id: "row-1", name: "1 · Opening", from: 0, duration: third },
    { id: "row-2", name: "2 · Middle", from: third, duration: third },
    { id: "row-3", name: "3 · Closing", from: third * 2, duration: options.duration - third * 2 },
  ];
  const rowMarkup = rows.map((row) => `    <section class="row" data-fd-clip data-fd-id="${row.id}" data-fd-name="${row.name}"
      data-fd-from="${row.from}" data-fd-duration="${row.duration}">
      <div class="when"></div>
      <p data-fd-id="${row.id}-text" data-fd-text="Describe this beat.">Describe this beat.</p>
    </section>`).join("\n");
  return `<!doctype html>
<html>
<head>
  <style>
    [data-fd-composition] { position: relative; overflow: hidden; background: #101116; color: #e9eaf0; font-family: system-ui, sans-serif; padding: 48px 56px; box-sizing: border-box; }
    h1 { font-size: 34px; margin: 0 0 18px; }
    .row { display: grid; grid-template-columns: 180px 1fr; gap: 24px; padding: 18px 4px; border-top: 1px solid rgba(255,255,255,.1); }
    .row.active { background: rgba(255,255,255,.05); }
    .row .when { font: 600 15px ui-monospace, monospace; color: #9aa0b5; }
    .row p { margin: 0; font-size: 17px; line-height: 1.6; }
  </style>
</head>
<body>
  <main data-fd-composition data-fd-id="${options.id}"
    data-fd-width="${options.width}" data-fd-height="${options.height}"
    data-fd-fps="${options.fps}" data-fd-duration="${options.duration}"
    data-fd-kind="plan" data-fd-source="${options.file}"
    data-fd-module="${options.module}" data-fd-export="${options.exportName}">
    <h1 data-fd-id="plan-title" data-fd-text="${options.id}">${options.id}</h1>
${rowMarkup}
    <script>
      // Rows are clips: dragging them in the timeline reprints this document, and
      // generateEditSkeleton(source) turns it into a master edit with one slot per row.
      const rows = queryAll(".row");
      const fps = ${options.fps};
      const timecode = (frames) => {
        const seconds = Math.round(frames / fps);
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      };
      for (const row of rows) {
        const from = Number(row.getAttribute("data-fd-from"));
        const duration = Number(row.getAttribute("data-fd-duration"));
        row.querySelector(".when").textContent = timecode(from) + "–" + timecode(from + duration);
      }
      onFrame(({ frame }) => {
        for (const row of rows) {
          const from = Number(row.getAttribute("data-fd-from"));
          const duration = Number(row.getAttribute("data-fd-duration"));
          row.classList.toggle("active", frame >= from && frame < from + duration);
        }
      });
    </script>
  </main>
</body>
</html>
`;
}

function htmlCompositionModule(htmlFile: string, exportName: string, setupImport?: string): string {
  const fileName = htmlFile.split("/").pop()!;
  return `import { defineComposition } from "framediff";
import source from "./${fileName}?raw";
${setupImport ? `${setupImport}\n` : ""}
export const ${exportName} = defineComposition(source${setupImport ? ", { setup: sourceComposition.setup }" : ""});
`;
}

const GENERATIVE_ASPECTS = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["9:16", 9 / 16],
] as const;

function nearestGenerativeAspect(width: number, height: number): (typeof GENERATIVE_ASPECTS)[number][0] {
  const ratio = width / height;
  return GENERATIVE_ASPECTS.reduce((nearest, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(nearest[1] - ratio) ? candidate : nearest,
  )[0];
}

function generativeCompositionModule(options: {
  id: string;
  exportName: string;
  file: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}): string {
  const duration = Number((options.durationInFrames / options.fps).toFixed(6));
  return `import { generative } from "framediff";

export const ${options.exportName} = generative({
  id: ${JSON.stringify(options.id)},
  file: ${JSON.stringify(options.file)},
  provider: "fal",
  model: "seedance-2.0",
  prompt: "Describe the shot you want to generate.",
  tier: "fast",
  resolution: "720p",
  duration: ${duration},
  aspect: "${nearestGenerativeAspect(options.width, options.height)}",
  audio: true,
  fps: ${options.fps},
  take: 0,
});
`;
}

function describeRegistry(registry: CompRegistry): CompositionDescriptor[] {
  return Object.entries(registry).map(([key, composition]) => ({
    key,
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
    kind: composition.meta?.kind ?? "edit",
    outputKind: composition.meta?.output ?? "video",
    file: composition.meta?.file,
    sources: [...new Set([
      composition.meta?.file,
      composition.meta?.module,
      ...(composition.meta?.deps ?? []),
      ...(composition.meta?.editableData ?? []).map((source) => source.file),
    ].filter((file): file is string => !!file))],
    library: composition.meta?.library,
    render: composition.meta?.render,
    guide: composition.meta?.guide,
  }));
}

export class HtmlStudioRuntime implements CompositionRuntimePort {
  private registry: CompRegistry;
  private listeners = new Set<(compositions: CompositionDescriptor[]) => void>();
  private previews = new Set<PreviewRecord>();
  private probed = new Map<string, TimelineItemSnapshot[]>();
  private manifest: AssetManifest | undefined;
  private resolver: AssetResolver | undefined;
  private assetsLoaded = false;
  private readonly assetsReady: Promise<void>;
  private inspectorLocations = new Map<string, LiteralLoc | StringLiteralLoc>();
  private editListeners = new Set<ProjectEditListener>();
  private cacheProbe: Promise<CacheEntry[]> | null = null;

  public constructor(registry: CompRegistry) {
    this.registry = registry;
    this.assetsReady = this.loadAssets()
      .catch((error) => console.error("FrameDiff could not load the asset manifest.", error))
      .finally(() => {
        this.assetsLoaded = true;
        for (const preview of this.previews) this.renderPreview(preview);
      });
  }

  public getCompositions(): CompositionDescriptor[] {
    return describeRegistry(this.registry);
  }

  public subscribeCompositions(listener: (compositions: CompositionDescriptor[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public subscribeProjectEdits(listener: ProjectEditListener): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  public async replayProjectEdit(receipt: ProjectEditReceipt, direction: "undo" | "redo"): Promise<ProjectEditResult> {
    const target = direction === "undo" ? receipt.before : receipt.after;
    const expected = new Map((direction === "undo" ? receipt.after : receipt.before).map((entry) => [entry.file, entry.hash]));
    const result = await applySourceEdit({
      label: `${direction === "undo" ? "Undo" : "Redo"} ${receipt.label}`,
      files: target.map((entry) => ({ file: entry.file, expectedHash: expected.get(entry.file) ?? null, text: entry.text })),
    });
    return result.ok
      ? { ok: true, receipt: result.receipt }
      : { ok: false, conflicts: result.conflicts, message: result.error };
  }

  private async commitSourceText(
    label: string,
    before: { file: string; text: string | null; hash: string | null },
    text: string | null,
    groupId?: string,
  ): Promise<ProjectEditResult> {
    const result = await applySourceEdit({
      label,
      ...(groupId ? { groupId } : {}),
      files: [{ file: before.file, expectedHash: before.hash, text }],
    });
    if (!result.ok || !result.receipt) {
      return { ok: false, conflicts: result.conflicts, message: result.error ?? `Could not write ${before.file}.` };
    }
    for (const listener of this.editListeners) listener(result.receipt);
    return { ok: true, receipt: result.receipt };
  }

  public replaceRegistry(registry: CompRegistry): void {
    const previous = this.registry;
    this.registry = registry;
    this.probed.clear();
    const descriptions = this.getCompositions();
    for (const listener of this.listeners) listener(descriptions);
    for (const preview of this.previews) {
      const before = previous[preview.compositionKey];
      const after = registry[preview.compositionKey];
      const canSwap = preview.handle
        && preview.stage
        && preview.mountedKey === preview.compositionKey
        && before
        && after
        && before.width === after.width
        && before.height === after.height;
      if (canSwap) void this.swapPreview(preview, after);
      else {
        preview.swapRevision += 1;
        preview.handle?.destroy();
        preview.handle = undefined;
        preview.mountedKey = undefined;
        this.renderPreview(preview);
      }
    }
  }

  public async probe(compositionKey: string): Promise<TimelineItemSnapshot[]> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);

    await this.assetsReady;
    const physicalSource = composition.meta?.file && composition.meta?.sourceFormat !== "generated"
      ? await readSource(composition.meta.file)
      : null;
    // Do not wait for Vite HMR to make an accepted source transaction inspectable. The registry
    // remains the preview authority, while the derived project view reads the just-committed HTML.
    const inspectable = physicalSource == null ? composition : { ...composition, html: physicalSource };
    const rawItems = timelineFromHtml(inspectable);
    const cache = rawItems.some((item) => item.content.type === "nested") ? await this.cacheForProbe() : [];
    const artifactChecks = new Map<string, Promise<{ artifactStatus: "current" | "stale" | "missing" | "remote"; pinnedTake?: number }>>();
    const localChecks = new Map<string, Promise<boolean>>();
    const local = (hash: string) => {
      let check = localChecks.get(hash);
      if (!check) { check = this.resolver?.cas.has(hash) ?? Promise.resolve(false); localChecks.set(hash, check); }
      return check;
    };
    const latest = await Promise.all(rawItems.map(async (item) => {
      const content = item.content;
      const source = content.type === "video" || content.type === "audio" ? content.src : undefined;
      const assetId = source?.startsWith("asset://") ? source.slice("asset://".length) : undefined;
      const asset = assetId ? this.manifest?.assets[assetId] : undefined;
      const nestedCompositionKey = content.type === "nested"
        ? Object.entries(this.registry).find(([, candidate]) => candidate.id === content.compId)?.[0]
        : undefined;
      const originalLocal = asset ? await local(asset.contentHash) : false;
      const proxyLocal = asset?.proxy ? await local(asset.proxy) : false;
      let artifact: { artifactStatus: "current" | "stale" | "missing" | "remote"; pinnedTake?: number } | undefined;
      if (nestedCompositionKey) {
        let check = artifactChecks.get(nestedCompositionKey);
        if (!check) { check = this.nestedArtifactState(nestedCompositionKey, cache); artifactChecks.set(nestedCompositionKey, check); }
        artifact = await check;
      }
      const production: TimelineItemSnapshot["production"] = {
        ...(assetId ? { assetId } : {}),
        ...(asset?.contentHash ? { contentHash: originalLocal || !proxyLocal ? asset.contentHash : asset.proxy! } : {}),
        ...(asset?.proxy ? { proxyContentHash: asset.proxy } : {}),
        ...(asset && (originalLocal || proxyLocal) ? { rendition: originalLocal ? "original" as const : "proxy" as const } : {}),
        ...(asset?.durationSeconds != null ? { sourceDurationSeconds: asset.durationSeconds } : {}),
        ...(source ? { availability: originalLocal || proxyLocal || this.resolver?.peek(source) ? "local" as const : asset ? "remote" as const : "missing" as const } : {}),
        ...(nestedCompositionKey ? { nestedCompositionKey } : {}),
        ...(artifact ?? {}),
        effects: "effects" in content && !!content.effects?.length,
      };
      return composition.meta?.sourceFormat === "generated"
        ? { ...item, production, editable: { from: false, duration: false, layer: false, trimStart: false } }
        : { ...item, production };
    }));
    this.probed.set(compositionKey, latest);
    return latest;
  }

  public async probeAnimations(compositionKey: string): Promise<AnimationProbeSnapshot> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    const files = await this.loadCompositionSources(compositionKey);
    const candidates = [composition.meta?.module, ...(composition.meta?.deps ?? [])]
      .filter((file): file is string => !!file && /\.[cm]?[jt]sx?$/.test(file));
    const analyses = [...new Set(candidates)].flatMap((file) => {
      const source = files[file];
      return source ? [analyzeGsapSource(source, { fps: composition.fps, file })] : [];
    });
    const sourceGroups = [...new Set(candidates)].flatMap((file) => {
      const source = files[file];
      return source ? analyzeGsapUnrollGroups(source, { fps: composition.fps, file }) : [];
    });
    let runtimeGroups = getGsapRuntimeTraces(composition.id);
    if (sourceGroups.length && !runtimeGroups.length) {
      const host = document.createElement("div");
      const handle = mountComposition(host, composition, { registry: this.registry, resolver: this.resolver, frame: 0, playing: false });
      try {
        await handle.ready;
        runtimeGroups = getGsapRuntimeTraces(composition.id);
      } finally {
        handle.destroy();
      }
    }
    return {
      animations: analyses.flatMap((analysis) => analysis.operations),
      diagnostics: analyses.flatMap((analysis) => analysis.diagnostics),
      opaqueCallCount: analyses.reduce((sum, analysis) => sum + analysis.opaqueCallCount, 0),
      unrollGroups: sourceGroups.map((group) => {
        const trace = runtimeGroups.find((entry) => entry.id === group.id);
        const issues = [...group.issues, ...(trace?.issues ?? []), ...(!trace ? ["Runtime trace is not available yet."] : [])];
        return {
          id: group.id,
          timeline: group.timeline,
          source: group.source,
          operations: trace?.operations ?? [],
          safe: group.staticallySafe && trace?.serializable === true,
          issues,
        };
      }),
    };
  }

  public async unrollAnimationGroup(request: UnrollGroupRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    if (!composition) return { ok: false, message: `Unknown composition: ${request.compositionKey}` };
    const probe = await this.probeAnimations(request.compositionKey);
    const group = probe.unrollGroups?.find((entry) => entry.id === request.groupId);
    const file = group?.source.file;
    if (!group || !file) return { ok: false, message: `Unroll group "${request.groupId}" no longer exists.` };
    if (!group.safe) return { ok: false, file, message: group.issues.join("; ") || "The helper trace is not serializable." };
    const revision = await readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const rewritten = rewriteGsapUnrollSource(revision.text, {
      fps: composition.fps,
      file,
      groupId: request.groupId,
      operations: group.operations,
    });
    if (!rewritten.ok) return { ok: false, file, message: rewritten.error };
    const committed = await this.commitSourceText(`Unroll ${request.groupId} to edit`, revision, rewritten.text);
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async editAnimation(request: AnimationEditRequest): Promise<PlacementEditResult> {
    return this.editAnimations([request]);
  }

  public async editAnimations(requests: AnimationEditRequest[]): Promise<PlacementEditResult> {
    if (!requests.length) return { ok: false, message: "No animation edits were requested." };
    const compositionKey = requests[0].compositionKey;
    if (requests.some((request) => request.compositionKey !== compositionKey)) {
      return { ok: false, message: "Atomic animation edits must target one composition." };
    }
    const composition = this.registry[compositionKey];
    if (!composition) return { ok: false, message: `Unknown composition: ${compositionKey}` };
    const files = await this.loadCompositionSources(compositionKey);
    const candidates = [composition.meta?.module, ...(composition.meta?.deps ?? [])]
      .filter((file): file is string => !!file && /\.[cm]?[jt]sx?$/.test(file));
    const located = requests.map((request) => {
      for (const file of candidates) {
        const source = files[file];
        if (source && analyzeGsapSource(source, { fps: composition.fps, file }).operations.some((entry) => entry.id === request.animationId)) {
          return { request, file };
        }
      }
      return { request, file: undefined };
    });
    const sourceFiles = new Set(located.map((entry) => entry.file).filter((file): file is string => !!file));
    if (located.some((entry) => !entry.file)) return { ok: false, message: "One or more registered animations no longer exist in source." };
    if (sourceFiles.size !== 1) return { ok: false, message: "One grouped animation edit currently needs to stay within one source module." };
    const file = [...sourceFiles][0];
    const revision = await readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    let text = revision.text;
    for (const { request } of located) {
      const rewritten = rewriteGsapAnimationSource(text, {
        fps: composition.fps,
        file,
        animationId: request.animationId,
        mutation: request.mutation,
      });
      if (!rewritten.ok) return { ok: false, file, message: rewritten.error };
      text = rewritten.text;
    }
    const committed = await this.commitSourceText(
      requests[0].label ?? (requests.length === 1 ? `Edit ${requests[0].animationId}` : "Edit animation keys"),
      revision,
      text,
      requests[0].groupId,
    );
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async createAnimation(request: AnimationCreateRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const file = composition?.meta?.module;
    if (!composition || !file) return { ok: false, message: "This composition needs a source module with defineGsapTimeline() before a stopwatch can be enabled." };
    const revision = await readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const id = `${request.objectId}-${request.property}`.replace(/[^A-Za-z0-9_-]+/g, "-");
    const inserted = insertGsapTweenSource(revision.text, {
      fps: composition.fps,
      file,
      id,
      target: `[data-fd-id="${request.objectId.replaceAll('"', '\\"')}"]`,
      property: request.property,
      from: request.from,
      to: request.to,
      startFrame: request.startFrame,
      durationInFrames: request.durationInFrames ?? Math.round(composition.fps),
      ease: request.ease,
    });
    if (!inserted.ok) return { ok: false, file, message: inserted.error };
    const committed = await this.commitSourceText(request.label ?? `Animate ${request.objectId} ${request.property}`, revision, inserted.text);
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async editMotionPath(request: MotionPathEditRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    if (!composition) return { ok: false, message: `Unknown composition: ${request.compositionKey}` };
    const files = await this.loadCompositionSources(request.compositionKey);
    const candidates = [composition.meta?.module, ...(composition.meta?.deps ?? [])].filter((file): file is string => !!file);
    const file = candidates.find((candidate) => files[candidate]
      && analyzeGsapSource(files[candidate], { fps: composition.fps, file: candidate }).operations.some((entry) => entry.id === request.animationId));
    if (!file) return { ok: false, message: `Animation "${request.animationId}" no longer exists in source.` };
    const revision = await readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const rewritten = rewriteGsapMotionPathSource(revision.text, {
      fps: composition.fps,
      file,
      animationId: request.animationId,
      path: request.path,
    });
    if (!rewritten.ok) return { ok: false, file, message: rewritten.error };
    const committed = await this.commitSourceText(request.label ?? `Edit ${request.animationId} path`, revision, rewritten.text, request.groupId);
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async createMotionPath(request: MotionPathCreateRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const file = composition?.meta?.module;
    const segments = parseMotionPathSvg(request.path);
    if (!composition || !file) return { ok: false, message: "This composition needs a registered GSAP source module for gesture paths." };
    if (!segments) return { ok: false, file, message: "Gesture fitting did not produce a valid cubic path." };
    const revision = await readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const id = `${request.objectId}-motion-path`.replace(/[^A-Za-z0-9_-]+/g, "-");
    const from = segments[0].from;
    const to = segments.at(-1)!.to;
    const inserted = insertGsapTweenSource(revision.text, {
      fps: composition.fps,
      file,
      id,
      target: `[data-fd-id="${request.objectId.replaceAll('"', '\\"')}"]`,
      property: "x",
      from: from.x,
      to: to.x,
      startFrame: request.startFrame,
      durationInFrames: request.durationInFrames,
      ease: "none",
    });
    if (!inserted.ok) return { ok: false, file, message: inserted.error };
    const rewritten = rewriteGsapMotionPathSource(inserted.text, {
      fps: composition.fps,
      file,
      animationId: id,
      path: request.path,
    });
    if (!rewritten.ok) return { ok: false, file, message: rewritten.error };
    const committed = await this.commitSourceText(request.label ?? `Record ${request.objectId} gesture`, revision, rewritten.text);
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async editPlacement(request: PlacementEditRequest): Promise<PlacementEditResult> {
    return this.editPlacements([request]);
  }

  public async editPlacements(requests: PlacementEditRequest[]): Promise<PlacementEditResult> {
    if (!requests.length) return { ok: false, message: "No placement edits were requested." };
    const compositionKey = requests[0].compositionKey;
    if (requests.some((request) => request.compositionKey !== compositionKey)) {
      return { ok: false, message: "Atomic placement edits must target one composition." };
    }
    const composition = this.registry[compositionKey];
    const file = composition?.meta?.file;
    if (!composition || !file) return { ok: false, message: "This composition does not declare a source file." };
    const revision = await readSourceRevision(file);
    const text = revision?.text;
    if (!revision || text == null) return { ok: false, file, message: `Could not read ${file} through the FrameDiff dev bridge.` };

    let nextText = text;
    for (const request of requests.filter((entry) => entry.field !== "layer")) {
      const attribute = request.field === "from"
        ? "data-fd-from"
        : request.field === "trimStart"
          ? "data-fd-trim-start"
          : "data-fd-duration";
      const value = request.field === "durationInFrames"
        ? Math.max(1, Math.round(request.value))
        : request.field === "trimStart"
          ? Math.max(0, Math.round(request.value * 1_000_000) / 1_000_000)
          : Math.round(request.value);
      const rewritten = rewriteHtmlAttribute(nextText, request.itemId, attribute, value);
      if (rewritten == null) return { ok: false, file, message: `Clip "${request.itemId}" needs a stable data-fd-id before it can be edited.` };
      nextText = rewritten;
    }
    const layerRequests = requests.filter((entry) => entry.field === "layer");
    if (layerRequests.length) {
      const snapshot = timelineFromHtml({ ...composition, html: nextText });
      const laneByItem = new Map(buildTimelineLanes(snapshot).flatMap((lane) => lane.items.map((item) => [item.id, lane.layer ?? 0] as const)));
      const requestedLayer = new Map(layerRequests.map((request) => [request.itemId, Math.round(request.value)]));
      const category = (item: TimelineItemSnapshot) => item.content.type === "audio" ? "audio" : item.content.type === "grade-layer" ? "grade" : "video";
      const touchedCategories = new Set(snapshot.filter((item) => requestedLayer.has(item.id)).map(category));
      for (const group of touchedCategories) {
        const groupItems = snapshot.filter((item) => category(item) === group && !item.id.startsWith("clip:"));
        const ranks = [...new Set(groupItems.map((item) => requestedLayer.get(item.id) ?? item.layer ?? laneByItem.get(item.id) ?? 0))].sort((a, b) => a - b);
        const normalized = new Map(ranks.map((rank, index) => [rank, index]));
        for (const item of groupItems) {
          const rank = requestedLayer.get(item.id) ?? item.layer ?? laneByItem.get(item.id) ?? 0;
          const rewritten = rewriteHtmlAttribute(nextText, item.id, "data-fd-layer", normalized.get(rank) ?? 0);
          if (rewritten == null) return { ok: false, file, message: `Clip "${item.id}" needs a stable data-fd-id before its layer can be edited.` };
          nextText = rewritten;
        }
      }
    }
    const committed = await this.commitSourceText(
      requests.length === 1 ? "Edit clip placement" : "Edit clip placement fields",
      revision,
      nextText,
    );
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async inspectItem(compositionKey: string, itemId: string): Promise<InspectorDetailsSnapshot> {
    const composition = this.registry[compositionKey];
    const item = this.probed.get(compositionKey)?.find((entry) => entry.id === itemId);
    if (!composition) return { compositionKey, itemId, sections: [] };
    const files = await this.loadCompositionSources(compositionKey);
    const file = composition.meta?.file;
    const sections: InspectorSectionSnapshot[] = [];
    const locationKey = (fieldId: string) => `${compositionKey}:${itemId}:${fieldId}`;
    const remember = (fieldId: string, resolved: ResolvedExpr | StringLiteralLoc | undefined) => {
      if (resolved?.kind === "literal") this.inspectorLocations.set(locationKey(fieldId), resolved);
      if (resolved?.kind === "string-literal") this.inspectorLocations.set(locationKey(fieldId), resolved);
    };

    // Generated HTML often contains template expressions rather than rewriteable authored
    // attribute literals. Its explicit editableData declarations remain available below.
    if (file && files[file] && composition.meta?.sourceFormat !== "generated") {
      const fields = inspectorFieldsFromHtml(files[file], itemId);
      const grade = fields.filter((field) => htmlGradeAttributes.includes(field.attribute) || ["data-fd-lut", "data-fd-lut-name", "data-fd-lut-intensity"].includes(field.attribute));
      const properties = fields.filter((field) => !grade.includes(field));
      if (properties.length) sections.push({ id: "properties", title: "PROPERTIES", kind: "data", fields: properties });
      if (grade.length) {
        sections.push({
          id: "grade",
          title: "COLOR GRADE",
          kind: "grade",
          fields: grade,
          presets: Object.entries(GRADE_PRESETS).map(([id, preset]) => ({ id, label: preset.label })),
        });
      }
    }

    // Stable descendant elements are valid Inspector selections even when they are not timeline
    // placements. Code-backed editableData below is placement-oriented and needs an item row.
    if (!item) return { compositionKey, itemId, sections };

    for (const source of composition.meta?.editableData ?? []) {
      if (!files[source.file]) continue;
      if (source.type === "camera3d") {
        const row = parseObjectArray(source.file, files, source.exportName, [...CAMERA3D_FIELD_KEYS], source.keyField)
          .find((entry) => entry.key === item.name);
        if (!row) continue;
        const fields = CAMERA3D_FIELD_KEYS.flatMap((key) => {
          const resolved = row.fields[key];
          if (!resolved) return [];
          const fieldId = `data:${source.file}:${source.exportName}:${key}`;
          remember(fieldId, resolved);
          return [{ id: fieldId, label: key, value: resolved.value, editable: resolved.kind === "literal", step: 0.01, source: resolved.kind === "literal" ? resolved.file : resolved.expr }];
        });
        sections.push({ id: `camera:${source.exportName}`, title: source.title ?? "VIRTUAL CAMERA", kind: "camera", fields });
      } else if (source.type === "object-array") {
        const defs = source.fields.map((field) => typeof field === "string"
          ? { key: field, label: field, type: "number" as const }
          : { key: field.key, label: field.label ?? field.key, type: field.type ?? "number" });
        const row = parseObjectArray(source.file, files, source.exportName, defs.map((entry) => entry.key), source.keyField)
          .find((entry) => entry.key === item.name);
        const stringRow = parseObjectArrayStrings(
          source.file,
          files,
          source.exportName,
          defs.filter((entry) => entry.type === "text").map((entry) => entry.key),
          source.keyField,
        ).find((entry) => entry.key === item.name);
        if (!row && !stringRow) continue;
        const fields = defs.flatMap<InspectorFieldSnapshot>((definition): InspectorFieldSnapshot[] => {
          const resolved = definition.type === "text" ? stringRow?.fields[definition.key] : row?.fields[definition.key];
          if (!resolved) return [];
          const fieldId = `data:${source.file}:${source.exportName}:${definition.key}`;
          remember(fieldId, resolved);
          return resolved.kind === "string-literal"
            ? [{ id: fieldId, label: definition.label, text: resolved.value, valueType: "text" as const, editable: true, source: resolved.file, control: { type: "text" as const, value: resolved.value, multiline: true } }]
            : [{ id: fieldId, label: definition.label, value: resolved.value, editable: resolved.kind === "literal", step: 0.01, source: resolved.kind === "literal" ? resolved.file : resolved.expr }];
        });
        sections.push({ id: `data:${source.exportName}`, title: source.title ?? source.exportName, kind: "data", fields });
      } else if (item.name) {
        const locations = parseNumericArrayProperty(source.file, files, source.exportName, item.name);
        const fields = locations.map((location, index) => {
          const fieldId = `data:${source.file}:${source.exportName}:${index}`;
          remember(fieldId, location);
          return { id: fieldId, label: source.labels?.[index] ?? `value ${index + 1}`, value: location.value, editable: true, step: 0.01, source: location.file };
        });
        if (fields.length) sections.push({ id: `data:${source.exportName}`, title: source.title ?? source.exportName, kind: "data", fields });
      }
    }
    return { compositionKey, itemId, sections };
  }

  public async editInspectorField(request: InspectorFieldEditRequest): Promise<PlacementEditResult> {
    if (request.fieldId.startsWith("html:") || request.fieldId.startsWith("html-target:")) {
      const composition = this.registry[request.compositionKey];
      const file = composition?.meta?.file;
      if (!file) return { ok: false, message: "This composition does not declare its HTML source file." };
      const revision = await readSourceRevision(file);
      const text = revision?.text;
      if (!revision || text == null) return { ok: false, file, message: `Could not read ${file}.` };
      const targetPrefix = "html-target:";
      const separator = request.fieldId.lastIndexOf(":data-fd-");
      const targeted = request.fieldId.startsWith(targetPrefix) && separator >= targetPrefix.length;
      const targetId = targeted ? decodeURIComponent(request.fieldId.slice(targetPrefix.length, separator)) : request.itemId;
      const attribute = targeted ? request.fieldId.slice(separator + 1) : request.fieldId.slice("html:".length);
      const rewritten = rewriteHtmlAttribute(text, targetId, attribute, request.value);
      if (rewritten == null) return { ok: false, file, message: `Could not find data-fd-id="${targetId}" in ${file}.` };
      const committed = await this.commitSourceText("Edit Inspector property", revision, rewritten);
      return committed.ok ? { ok: true, file, receipt: committed.receipt } : { ok: false, file, message: committed.message, conflicts: committed.conflicts };
    }
    return this.editInspectorFields({
      compositionKey: request.compositionKey,
      itemId: request.itemId,
      edits: [{ fieldId: request.fieldId, value: request.value }],
    });
  }

  public async editInspectorFields(request: InspectorFieldsEditRequest): Promise<PlacementEditResult> {
    if (!request.edits.length) return { ok: false, message: "No Inspector fields changed." };
    await this.inspectItem(request.compositionKey, request.itemId);
    const unique = [...new Map(request.edits.map((edit) => [edit.fieldId, edit])).values()];
    const resolved = unique.map((edit) => ({
      edit,
      location: this.inspectorLocations.get(`${request.compositionKey}:${request.itemId}:${edit.fieldId}`),
    }));
    const missing = resolved.find((entry) => !entry.location);
    if (missing) return { ok: false, message: `${missing.edit.fieldId} is computed and cannot be rewritten directly.` };
    for (const entry of resolved) {
      const location = entry.location!;
      if (location.kind === "string-literal" && typeof entry.edit.value !== "string") return { ok: false, message: `${entry.edit.fieldId} accepts text.` };
      if (location.kind === "literal" && (typeof entry.edit.value !== "number" || !Number.isFinite(entry.edit.value))) {
        return { ok: false, message: `${entry.edit.fieldId} accepts a finite number.` };
      }
    }
    const files = [...new Set(resolved.map((entry) => entry.location!.file))];
    const revisions = await Promise.all(files.map((file) => readSourceRevision(file)));
    const missingRevision = files.find((_, index) => !revisions[index]?.text);
    if (missingRevision) return { ok: false, file: missingRevision, message: `Could not read ${missingRevision}.` };
    const changed = files.map((file, index) => {
      const revision = revisions[index]!;
      let text = revision.text!;
      const edits = resolved
        .filter((entry) => entry.location!.file === file)
        .sort((left, right) => right.location!.start - left.location!.start);
      for (const entry of edits) {
        const location = entry.location!;
        text = location.kind === "string-literal"
          ? rewriteStringLiteral({ [file]: text }, location, entry.edit.value as string).text
          : rewriteLiteral({ [file]: text }, location, entry.edit.value as number).text;
      }
      return { revision, text };
    });
    const committed = await applySourceEdit({
      label: request.label ?? (unique.length === 1 ? "Edit source-backed property" : "Edit source-backed properties"),
      ...(request.groupId ? { groupId: request.groupId } : {}),
      files: changed.map(({ revision, text }) => ({ file: revision.file, expectedHash: revision.hash, text })),
    });
    if (!committed.ok || !committed.receipt) {
      return { ok: false, file: files[0], message: committed.error ?? "Could not edit source-backed properties.", conflicts: committed.conflicts };
    }
    for (const listener of this.editListeners) listener(committed.receipt);
    return { ok: true, file: files[0], receipt: committed.receipt };
  }

  public async editElementProperties(request: PreviewElementEditRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const file = composition?.meta?.file;
    if (!composition || !file) return { ok: false, message: "This composition has no editable HTML source." };
    if (composition.meta?.sourceFormat === "generated") return { ok: false, file, message: "Generated HTML must be unrolled before direct manipulation." };
    const entries = Object.entries(request.patch);
    if (!entries.length) return { ok: false, file, message: "No element properties changed." };
    if (entries.some(([, value]) => !Number.isFinite(value))) return { ok: false, file, message: "Element geometry must use finite numbers." };
    if ((request.patch.width != null && request.patch.width < 1) || (request.patch.height != null && request.patch.height < 1)) {
      return { ok: false, file, message: "Element dimensions must be at least one composition pixel." };
    }
    const attributes: Record<string, number> = {};
    for (const [property, value] of entries) attributes[`data-fd-${property}`] = Math.round(value * 1_000) / 1_000;
    const revision = await readSourceRevision(file);
    if (!revision || revision.text == null) return { ok: false, file, message: `Could not read ${file}.` };
    const rewritten = rewriteHtmlAttributes(revision.text, request.objectId, attributes);
    if (rewritten == null) return { ok: false, file, message: `Could not find data-fd-id="${request.objectId}" in ${file}.` };
    const committed = await this.commitSourceText(
      request.label ?? `Edit ${request.objectId} geometry`,
      revision,
      rewritten,
      request.groupId,
    );
    return committed.ok
      ? { ok: true, file, receipt: committed.receipt }
      : { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
  }

  public async applyGradePreset(compositionKey: string, itemId: string, presetId: string): Promise<PlacementEditResult> {
    const composition = this.registry[compositionKey];
    const file = composition?.meta?.file;
    const preset = GRADE_PRESETS[presetId];
    if (!composition || !file || !preset) return { ok: false, message: "The grade preset or source composition is unavailable." };
    const revision = await readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, file, message: `Could not read ${file}.` };
    let next = source;
    for (const [key, value] of Object.entries(preset.values)) {
      const rewritten = rewriteHtmlAttribute(next, itemId, `data-fd-grade-${key}`, value);
      if (rewritten == null) return { ok: false, file, message: `Could not find data-fd-id="${itemId}" in ${file}.` };
      next = rewritten;
    }
    const committed = await this.commitSourceText("Apply grade preset", revision, next);
    return committed.ok ? { ok: true, file, receipt: committed.receipt } : { ok: false, file, message: committed.message, conflicts: committed.conflicts };
  }

  public readSource(file: string): Promise<string | null> {
    return readSource(file);
  }

  public async listAssets() {
    const [manifest, cache] = await Promise.all([getAssets(), listCache()]);
    const filenameByHash = new Map(cache.flatMap((entry) =>
      entry.contentHash && entry.filename ? [[entry.contentHash, entry.filename] as const] : [],
    ));
    const previewByParentId = new Map(Object.entries(manifest?.assets ?? {}).flatMap(([, candidate]) =>
      candidate.derivedFrom && candidate.mime === "video/mp4"
        ? [[candidate.derivedFrom, candidate.contentHash] as const]
        : [],
    ));
    return Object.entries(manifest?.assets ?? {}).map(([id, asset]) => ({
      id,
      name: asset.name,
      filename: filenameByHash.get(asset.contentHash),
      mime: asset.mime,
      bytes: asset.bytes,
      contentHash: asset.contentHash,
      previewContentHash: asset.proxy ?? previewByParentId.get(id),
      durationSeconds: asset.durationSeconds,
    }));
  }

  public uploadAsset(file: File): Promise<string | null> {
    return uploadAssetThroughBridge(file);
  }

  public getGitStatus(): Promise<string[] | null> {
    return gitDirty();
  }

  public commit(message: string): Promise<string | null> {
    return gitCommit(message);
  }

  public async renderComposition(
    compositionKey: string,
    onProgress: (progress: RenderProgressSnapshot) => void,
  ): Promise<RenderResult> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    await this.assetsReady;
    const window = composition.meta?.render;
    const buffer = await exportVideo(composition, {
      width: composition.width,
      height: composition.height,
      codec: "avc1.640028",
      muxerCodec: "avc",
      bitrate: 8_000_000,
      resolver: this.resolver,
      registry: this.registry,
      contentDomain: this.contentDomainOf(compositionKey, composition),
      ...(window ? { startFrame: window.from, endFrame: window.to } : {}),
      onProgress: (progress) => {
        const completed = progress.phase === "audio"
          ? progress.audioFramesScanned
          : progress.phase === "render"
            ? progress.framesEncoded
            : progress.phase === "finalize"
              ? progress.totalFrames
              : 0;
        onProgress({ phase: progress.phase, completed, total: Math.max(1, progress.totalFrames) });
      },
    });
    const safeId = composition.id.replace(/[^a-zA-Z0-9_.-]+/g, "-").toLowerCase();
    const filename = `${safeId || "framediff"}.mp4`;
    downloadBuffer(buffer, filename);
    return { bytes: buffer.byteLength, filename };
  }

  public async captureFrame(compositionKey: string, requestedFrame: number): Promise<AgentFrameSnapshot> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    await this.assetsReady;
    const frame = Math.round(requestedFrame);
    const canvas = await captureCompositeFrame(composition, frame, {
      width: composition.width,
      height: composition.height,
      resolver: this.resolver,
      registry: this.registry,
    });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG encoding failed")), "image/png");
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Could not encode the frame snapshot."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    return {
      compositionKey,
      frame,
      width: composition.width,
      height: composition.height,
      mime: "image/png",
      contentHash: await hashBlob(blob),
      dataUrl,
    };
  }

  public async listCacheEntries() {
    return (await listCache()).map((entry) => ({
      name: entry.name,
      filename: entry.filename,
      contentHash: entry.contentHash,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      compId: entry.meta?.compId,
      label: entry.meta?.label,
      createdAt: entry.meta?.createdAt,
      inputs: entry.meta?.inputs,
    }));
  }

  public async bakeComposition(
    compositionKey: string,
    onProgress: (progress: RenderProgressSnapshot) => void,
    outputKind?: CompositionOutputKind,
  ): Promise<RenderResult> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    await this.assetsReady;
    const kind = outputKind ?? composition.meta?.output ?? "video";
    let blob: Blob;
    if (kind === "image") {
      onProgress({ phase: "prepare", completed: 0, total: 1 });
      const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.floor(composition.meta?.outputFrame ?? 0)));
      const canvas = await captureCompositeFrame(composition, frame, {
        width: composition.width,
        height: composition.height,
        resolver: this.resolver,
        registry: this.registry,
      });
      onProgress({ phase: "render", completed: 1, total: 1 });
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG encoding failed")), "image/png");
      });
      onProgress({ phase: "finalize", completed: 1, total: 1 });
    } else {
      const buffer = await exportVideo(composition, {
        width: composition.width,
        height: composition.height,
        codec: "avc1.640028",
        muxerCodec: "avc",
        bitrate: Math.round(composition.width * composition.height * composition.fps * 0.2),
        resolver: this.resolver,
        registry: this.registry,
        onProgress: (progress) => onProgress({
          phase: progress.phase,
          completed: progress.phase === "audio" ? progress.audioFramesScanned : progress.phase === "render" ? progress.framesEncoded : progress.phase === "finalize" ? progress.totalFrames : 0,
          total: Math.max(1, progress.totalFrames),
        }),
      });
      blob = new Blob([buffer], { type: "video/mp4" });
    }
    const hash = await hashBlob(blob);
    await new HttpFolderCAS().put(hash, blob, `${composition.id}.${kind}.${blob.type === "image/png" ? "png" : "mp4"}`);
    const sources = await this.loadCompositionSources(compositionKey);
    const inputs: Record<string, string> = {};
    for (const [file, text] of Object.entries(sources)) inputs[file] = await hashString(text);
    await writeArtifactMeta(hash, { compId: composition.id, label: `${composition.id} ${kind} bake`, inputs, createdAt: new Date().toISOString() });
    return { bytes: blob.size, filename: hash };
  }

  public async createComposition(request: NewCompositionRequest, relativeToKey: string): Promise<ProjectOperationResult> {
    const selectedParent = this.registry[relativeToKey];
    const relative = selectedParent ?? Object.values(this.registry)[0];
    if (!relative) return { ok: false, message: "No composition is available to supply project dimensions." };
    const pascal = pascalName(request.name);
    const key = kebabName(request.name);
    const varName = `${camelName(request.name)}Comp`;
    if (!pascal || !/^[A-Za-z]/.test(pascal)) {
      return { ok: false, message: `“${request.name}” doesn't make a valid name — start it with a letter.` };
    }
    if (this.registry[key] || Object.values(this.registry).some((entry) => entry.id === pascal)) {
      return { ok: false, message: `A composition named ${pascal} already exists.` };
    }
    const sources = await this.loadAllSources();
    const registryFile = await this.findRegistryFile();
    if (!registryFile) return { ok: false, message: "No COMPOSITIONS registry source file was found." };
    if (!sources[registryFile]) sources[registryFile] = (await readSource(registryFile)) ?? "";
    const isGenerative = request.kind === "generate";
    const file = isGenerative ? `src/${pascal}.gen.ts` : `src/${pascal}.html`;
    const module = isGenerative ? file : `src/${pascal}.ts`;
    const parentFile = selectedParent?.meta?.kind !== "generate" && selectedParent?.meta?.file?.endsWith(".html")
      ? selectedParent.meta.file
      : undefined;
    const parentSource = parentFile ? sources[parentFile] ?? await readSource(parentFile) : null;
    const placedParentSource = parentFile && parentSource && selectedParent
      ? insertNestedHtmlComposition(parentSource, selectedParent.id, {
          compId: pascal,
          name: pascal,
          from: 0,
          durationInFrames: request.durationInFrames,
        })
      : null;
    const finishCreation = async (): Promise<ProjectOperationResult> => {
      const nested = !!(parentFile && placedParentSource && await writeSource(parentFile, placedParentSource));
      return {
        ok: true,
        message: nested
          ? `Created ${pascal}, registered “${key}”, and nested it under ${selectedParent!.id}.`
          : `Created ${pascal} and registered “${key}” at the top level.`,
        compositionKey: key,
      };
    };
    if (isGenerative) {
      const recipe = generativeCompositionModule({
        id: pascal,
        exportName: varName,
        file,
        width: relative.width,
        height: relative.height,
        fps: relative.fps,
        durationInFrames: request.durationInFrames,
      });
      if (!(await writeSource(file, recipe))) return { ok: false, message: `Could not write ${file}.` };
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, file) });
      if (!inserted || !(await writeSource(registryFile, inserted.text))) {
        return { ok: false, message: `Wrote ${file}, but could not register it in ${registryFile}.` };
      }
      return finishCreation();
    }
    const scaffold = htmlCompositionScaffold({
      id: pascal,
      exportName: varName,
      file,
      module,
      kind: request.kind,
      width: relative.width,
      height: relative.height,
      fps: relative.fps,
      duration: request.durationInFrames,
    });
    if (!(await writeSource(file, scaffold))) return { ok: false, message: `Could not write ${file}.` };
    if (!(await writeSource(module, htmlCompositionModule(file, varName)))) return { ok: false, message: `Wrote ${file}, but could not write ${module}.` };
    const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, module) });
    if (!inserted || !(await writeSource(registryFile, inserted.text))) {
      return { ok: false, message: `Wrote ${file} and ${module}, but could not register them in ${registryFile}.` };
    }
    return finishCreation();
  }

  public async copyComposition(compositionKey: string, options?: { library?: boolean }): Promise<ProjectOperationResult> {
    const source = this.registry[compositionKey];
    if (!source) return { ok: false, message: "The composition is unavailable." };
    const toLibrary = options?.library === true;
    const registryFile = await this.findRegistryFile();
    if (!registryFile) return { ok: false, message: "No COMPOSITIONS registry source file was found." };
    const sources = await this.loadAllSources();
    if (!sources[registryFile]) sources[registryFile] = (await readSource(registryFile)) ?? "";
    let pascal = `${source.id}Copy`;
    for (let index = 2; this.registry[kebabName(pascal)] || Object.values(this.registry).some((entry) => entry.id === pascal); index += 1) {
      pascal = `${source.id}Copy${index}`;
    }
    const key = kebabName(pascal);
    const varName = `${camelName(pascal)}Comp`;
    const sourceFile = source.meta?.file;
    if (!sourceFile) return { ok: false, message: `${source.id} does not declare data-fd-source.` };
    let text = sources[sourceFile] ?? await readSource(sourceFile);
    if (text == null) return { ok: false, message: `Could not read ${sourceFile}.` };
    const directory = sourceFile.split("/").slice(0, -1).join("/") || "src";
    const file = `${directory}/${pascal}.html`;
    const module = `${directory}/${pascal}.ts`;
    text = rewriteHtmlAttribute(text, source.id, "data-fd-id", pascal) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-source", file) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-module", module) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-export", varName) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-library", toLibrary || source.meta?.library === true) ?? text;
    if (!(await writeSource(file, text))) return { ok: false, message: `Could not write ${file}.` };
    const setupImport = source.meta?.module && source.meta?.exportName
      ? `import { ${source.meta.exportName} as sourceComposition } from "${relModule(module, source.meta.module)}";`
      : undefined;
    if (!(await writeSource(module, htmlCompositionModule(file, varName, setupImport)))) return { ok: false, message: `Wrote ${file}, but could not write ${module}.` };
    const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, module) });
    if (!inserted || !(await writeSource(registryFile, inserted.text))) return { ok: false, message: `Wrote ${file}, but could not register it.` };
    return {
      ok: true,
      message: toLibrary ? `Copied ${source.id} to ${pascal} in the library.` : `Duplicated ${source.id} as ${pascal}.`,
      compositionKey: key,
    };
  }

  public async deleteComposition(compositionKey: string): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition) return { ok: false, message: "The composition is unavailable." };
    const registryFile = await this.findRegistryFile();
    if (!registryFile) return { ok: false, message: "No COMPOSITIONS registry source file was found." };
    const sources = await this.loadAllSources();
    if (!sources[registryFile]) sources[registryFile] = (await readSource(registryFile)) ?? "";
    const exportName = composition.meta?.exportName;
    if (!exportName) return { ok: false, message: `${composition.id} does not declare data-fd-export and cannot be removed safely.` };
    const escapedId = composition.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nestedReference = new RegExp(`\\bdata-fd-comp\\s*=\\s*["']${escapedId}["']`);
    const references = Object.entries(sources)
      .filter(([file]) => file !== registryFile && file !== composition.meta?.file && file !== composition.meta?.module)
      .filter(([, text]) => nestedReference.test(text))
      .map(([file]) => file);
    if (references.length) {
      return { ok: false, message: `${composition.id} is nested in ${references.join(", ")} — remove it there first.` };
    }
    const removed = removeRegistryEntry(registryFile, sources, exportName);
    if (!removed || !(await writeSource(registryFile, removed.text))) {
      return { ok: false, message: `Could not remove "${compositionKey}" from ${registryFile}.` };
    }
    const file = composition.meta?.file;
    const module = composition.meta?.module;
    const ownsSources = composition.meta?.sourceFormat !== "generated"
      && !!file
      && !Object.entries(this.registry).some(([key, other]) => key !== compositionKey && (other.meta?.file === file || (module && other.meta?.module === module)));
    if (!ownsSources) return { ok: true, message: `Unregistered ${composition.id}; its shared source remains in place.` };
    const deletedFile = await deleteSource(file);
    const deletedModule = module ? await deleteSource(module) : true;
    return {
      ok: true,
      message: deletedFile && deletedModule
        ? `Deleted ${composition.id} and its HTML source.`
        : `Unregistered ${composition.id}; remove its remaining source files by hand.`,
    };
  }

  public async nestComposition(targetKey: string, sourceKey: string, from: number): Promise<ProjectOperationResult> {
    const target = this.registry[targetKey];
    const source = this.registry[sourceKey];
    if (!target || !source) return { ok: false, message: "The composition is unavailable." };
    const file = target.meta?.file;
    if (!file || target.meta?.sourceFormat === "generated") return { ok: false, message: `${target.id} does not have a physical HTML source that can accept layers.` };
    const revision = await readSourceRevision(file);
    const text = revision?.text;
    if (!revision || text == null) return { ok: false, message: `Could not read ${file} through the FrameDiff dev bridge.` };
    const next = insertNestedHtmlComposition(text, target.id, {
      compId: source.id,
      name: source.id,
      from,
      durationInFrames: source.durationInFrames,
    });
    if (!next) return { ok: false, message: `Could not find the ${target.id} composition root in ${file}.` };
    const committed = await this.commitSourceText(`Nest ${source.id} in ${target.id}`, revision, next);
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not write ${file}.` };
    return { ok: true, message: `Nested ${source.id} into ${target.id} at f${Math.round(from)}.`, compositionKey: targetKey, receipt: committed.receipt };
  }

  public async setCompositionLibrary(compositionKey: string, library: boolean): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    const file = composition?.meta?.file;
    if (!composition || !file) return { ok: false, message: "The composition does not declare its HTML source." };
    const revision = await readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${file}.` };
    const next = rewriteHtmlAttribute(source, composition.id, "data-fd-library", library);
    if (next == null) return { ok: false, message: "The composition root needs a stable data-fd-id." };
    const committed = await this.commitSourceText(`${library ? "Add" : "Remove"} ${composition.id} ${library ? "to" : "from"} library`, revision, next);
    if (!committed.ok) return { ok: false, message: committed.message ?? "The composition library state could not be written." };
    return { ok: true, message: `${composition.id} ${library ? "added to" : "removed from"} the library.`, receipt: committed.receipt };
  }

  public async setRenderWindow(compositionKey: string, from: number, to: number): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition) return { ok: false, message: "The composition is unavailable." };
    const total = composition.durationInFrames;
    // the window roams the open axis — before frame 0 and past the comp's end are both legal
    const clampedFrom = Math.round(from);
    const clampedTo = Math.max(clampedFrom + 1, Math.round(to));
    const window = clampedFrom === 0 && clampedTo === total ? null : { from: clampedFrom, to: clampedTo };
    const file = composition.meta?.file;
    if (!file) return { ok: false, message: "The composition does not declare its HTML source." };
    const revision = await readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${file}.` };
    let next = source;
    if (window) {
      next = rewriteHtmlAttribute(next, composition.id, "data-fd-render-from", clampedFrom) ?? next;
      next = rewriteHtmlAttribute(next, composition.id, "data-fd-render-to", clampedTo) ?? next;
    } else {
      next = removeHtmlAttribute(next, composition.id, "data-fd-render-from") ?? next;
      next = removeHtmlAttribute(next, composition.id, "data-fd-render-to") ?? next;
    }
    const committed = await this.commitSourceText("Edit render window", revision, next);
    if (!committed.ok) return { ok: false, message: committed.message ?? "The render window cannot be written for this composition.", conflicts: committed.conflicts };
    return {
      ok: true,
      message: window ? `Render window set to ${clampedFrom}–${clampedTo}f.` : "Render window reset to the full composition.",
      receipt: committed.receipt,
    };
  }

  public async getGenerativeWorkspace(compositionKey: string): Promise<GenerativeWorkspaceSnapshot | null> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return null;
    const recipe = (composition as GenerativeComposition).recipe;
    const definition = genModelOf(recipe);
    const liveHash = await recipeHashOf(recipe);
    const data = await genJobs(recipe.id) ?? { jobs: [], takes: [] };
    primeGenTakes(data.takes);
    const active = data.jobs.some((job) => job.status === "queued" || job.status === "running");
    const pinned = data.takes.find((take) => take.generator.take === (recipe.take ?? 0));
    const status = active ? "running" : !data.takes.length ? "never" : !pinned ? "unpinned" : pinned.generator.recipeHash === liveHash ? "current" : "stale";
    const assets = await getAssets();
    const secrets = await getSecrets();
    const labelFor = (source: string) => source.startsWith("asset://")
      ? assets?.assets[source.slice(8)]?.name ?? source
      : source.startsWith("comp://")
        ? this.registry[source.slice(7)]?.id ?? source
        : source;
    const takeSettings = (take: (typeof data.takes)[number]) => {
      const historical = take.generator.recipe;
      if (!historical) return undefined;
      const historicalRecipe: GenRecipe = { id: recipe.id, ...historical };
      const historicalDefinition = genModelOf(historicalRecipe);
      return {
        model: historicalRecipe.model ?? historicalDefinition.id,
        modelName: historicalDefinition.name,
        prompt: historicalRecipe.prompt,
        negativePrompt: historicalRecipe.negativePrompt ?? "",
        acceptsNegativePrompt: historicalDefinition.negativePrompt,
        mode: historicalDefinition.modeOf(historicalRecipe),
        endpoint: historicalDefinition.endpointOf(historicalRecipe),
        costUsd: historicalDefinition.costUsd(historicalRecipe),
        params: historicalDefinition.params.map((param) => ({
          key: param.key, label: param.label, type: param.type, value: genParamValue(historicalRecipe, param),
          options: param.gate?.(historicalRecipe) ?? param.options, min: param.min, max: param.max, step: param.step,
          enabled: param.enabledIf?.(historicalRecipe) ?? true,
        })),
        refs: (historicalRecipe.refs ?? []).map((ref, index) => ({
          ...ref,
          label: labelFor(ref.src),
          contentHash: take.generator.inputs?.[index]?.contentHash,
        })),
      };
    };
    return {
      compositionKey,
      recipeId: recipe.id,
      file: recipe.file,
      model: recipe.model ?? definition.id,
      modelName: definition.name,
      models: Object.values(GEN_MODELS).map((model) => ({ id: model.id, name: model.name, vendor: model.vendor, baseline: model.baseline })),
      prompt: recipe.prompt,
      negativePrompt: recipe.negativePrompt ?? "",
      acceptsNegativePrompt: definition.negativePrompt,
      mode: definition.modeOf(recipe),
      endpoint: definition.endpointOf(recipe),
      costUsd: definition.costUsd(recipe),
      params: definition.params.map((param) => ({
        key: param.key, label: param.label, type: param.type, value: genParamValue(recipe, param),
        options: param.gate?.(recipe) ?? param.options, min: param.min, max: param.max, step: param.step,
        enabled: param.enabledIf?.(recipe) ?? true,
      })),
      refs: (recipe.refs ?? []).map((ref) => ({ ...ref, label: labelFor(ref.src) })),
      compositions: Object.entries(this.registry)
        .filter(([key, candidate]) => key !== compositionKey && candidate.id !== composition.id)
        .map(([key, candidate]) => ({ key, id: candidate.id, outputKind: candidate.meta?.output ?? "video" })),
      takes: data.takes.map((take) => ({
        take: take.generator.take, assetId: take.assetId, contentHash: take.contentHash, bytes: take.bytes,
        recipeHash: take.generator.recipeHash, endpoint: take.generator.endpoint, seed: take.generator.seed, at: take.generator.at,
        settings: takeSettings(take),
      })),
      jobs: data.jobs.map((job) => ({ id: job.id, status: job.status, error: job.error, take: job.take })),
      pinnedTake: recipe.take ?? 0,
      liveHash,
      status,
      providerReady: !!secrets?.providers.fal?.set,
    };
  }

  public async updateGenerativeRecipe(compositionKey: string, patch: Record<string, unknown>): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const file = recipe.file;
    if (!file) return { ok: false, message: "The recipe does not declare its source file." };
    const revision = await readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${file}.` };
    const { model: requestedModel, ...remainingPatch } = patch;
    const base = typeof requestedModel === "string"
      ? remapRecipeForModel(recipe, requestedModel).next
      : recipe;
    const next = withRecipe(base, remainingPatch as Partial<GenRecipe>);
    const rewritten = rewriteRecipeSource(source, next);
    if (!rewritten) return { ok: false, message: `Could not rewrite ${file}.` };
    const committed = await this.commitSourceText("Edit generative recipe", revision, rewritten.text);
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not rewrite ${file}.` };
    return { ok: true, message: `Updated ${Object.keys(patch).join(", ")} in ${file}.`, receipt: committed.receipt };
  }

  public async pinGenerationTake(compositionKey: string, take: number): Promise<ProjectOperationResult> {
    return this.updateGenerativeRecipe(compositionKey, { take });
  }

  public async startGenerationFromTake(compositionKey: string, take: number): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const historical = (await genJobs(recipe.id))?.takes.find((candidate) => candidate.generator.take === take);
    if (!historical) return { ok: false, message: `Take ${take} is unavailable.` };
    if (!recipe.file) return { ok: false, message: "The recipe does not declare its source file." };
    const revision = await readSourceRevision(recipe.file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${recipe.file}.` };
    const draft = forkGenRecipe(recipe, historical.generator.recipe, historical.generator.inputs);
    const rewritten = rewriteRecipeSource(source, draft);
    if (!rewritten) {
      return { ok: false, message: `Could not start a new take from take ${take} in ${recipe.file}.` };
    }
    const committed = await this.commitSourceText(`Start draft from take ${take}`, revision, rewritten.text);
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not start a new take from take ${take} in ${recipe.file}.` };
    return { ok: true, message: `Started a new take draft from take ${take}. Tweak it, then generate.`, receipt: committed.receipt };
  }

  public async submitGeneration(compositionKey: string): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const definition = genModelOf(recipe);
    const liveHash = await recipeHashOf(recipe);
    const resolved: (GenRef & { mime?: string; name?: string })[] = [];
    for (const ref of recipe.refs ?? []) {
      if (!ref.src.startsWith("comp://")) resolved.push(ref);
      else {
        const inputKey = ref.src.slice(7);
        const inputComp = this.registry[inputKey];
        if (!inputComp) return { ok: false, message: `Unknown input composition: ${inputKey}.` };
        const kind: CompositionOutputKind = ref.kind === "video" ? "video" : "image";
        const baked = await this.bakeComposition(inputKey, () => undefined, kind);
        resolved.push({
          kind: ref.kind,
          src: `/__framediff-cache/${encodeURIComponent(baked.filename)}`,
          mime: kind === "image" ? "image/png" : "video/mp4",
          name: `${inputComp.id}.${kind === "image" ? "png" : "mp4"}`,
        });
      }
    }
    const fields = definition.refFieldsOf(recipe);
    const result = await genSubmit({
      gen: recipe.id,
      endpoint: definition.endpointOf(recipe),
      recipeHash: liveHash,
      input: definition.buildInput(recipe),
      refs: resolved.map((ref, index) => ({
        kind: ref.kind,
        src: ref.src,
        authoredSrc: recipe.refs?.[index]?.src ?? ref.src,
        mime: ref.mime,
        name: ref.name,
        ...fields.find((field) => field.kind === ref.kind),
      })),
      recipe: genRecipeSnapshotOf(recipe),
    });
    return result.job
      ? { ok: true, message: `Submitted generation ${result.job.id.slice(0, 8)}…` }
      : { ok: false, message: result.error ?? "The generation request was refused." };
  }

  public async configureProvider(provider: string, key: string): Promise<ProjectOperationResult> {
    const saved = await putSecret(provider, key);
    if (!saved.ok) return { ok: false, message: saved.error ?? `Could not save the ${provider} key.` };
    const verified = await verifyProvider(provider);
    return verified.ok ? { ok: true, message: `${provider} is configured.` } : { ok: false, message: verified.error ?? `${provider} verification failed.` };
  }

  public mountPreview(host: HTMLElement, compositionKey: string, options: PreviewOptions): PreviewHandle {
    host.classList.add("framediff-html-preview");
    const preview: PreviewRecord = { host, compositionKey, options, swapRevision: 0, nodeListeners: new Set(), draftIds: new Set(), draftStyles: new Map() };
    this.previews.add(preview);
    this.renderPreview(preview);
    return {
      update: (nextKey, nextOptions) => {
        preview.compositionKey = nextKey;
        preview.options = nextOptions;
        this.renderPreview(preview);
      },
      subscribeNodes: (listener) => {
        preview.nodeListeners.add(listener);
        listener(previewNodes(preview));
        return () => preview.nodeListeners.delete(listener);
      },
      hitTest: (clientX, clientY) => {
        const root = preview.handle?.root;
        if (!root) return null;
        for (const hit of document.elementsFromPoint(clientX, clientY)) {
          let candidate = hit instanceof HTMLElement ? hit.closest<HTMLElement>("[data-fd-id]") : null;
          while (candidate && root.contains(candidate)) {
            const snapshot = previewElement(preview, candidate);
            if (snapshot) return snapshot;
            candidate = candidate.parentElement?.closest<HTMLElement>("[data-fd-id]") ?? null;
          }
        }
        return null;
      },
      applyDraft: (objectId, patch) => draftPreviewElement(preview, objectId, patch),
      clearDraft: (objectId) => clearPreviewDraft(preview, objectId),
      destroy: () => {
        if (!this.previews.delete(preview)) return;
        preview.swapRevision += 1;
        preview.handle?.destroy();
        preview.observer?.disconnect();
        preview.nodeListeners.clear();
        preview.draftIds.clear();
        preview.draftStyles.clear();
        preview.host.replaceChildren();
        preview.host.classList.remove("framediff-html-preview");
      },
    };
  }

  /**
   * Source edits replace the registry through Vite HMR. Build the new composition in a connected,
   * transparent host while the old frame remains visible, then exchange their roots synchronously.
   * This keeps source authority without flashing the entire canvas or resetting its fitted layout.
   */
  private async swapPreview(preview: PreviewRecord, composition: StudioComposition): Promise<void> {
    const stage = preview.stage;
    const previousHandle = preview.handle;
    if (!stage || !previousHandle) return this.renderPreview(preview);
    const revision = ++preview.swapRevision;
    const staging = document.createElement("div");
    staging.className = "framediff-preview-staging";
    staging.style.cssText = `position:absolute;inset:0;width:${composition.width}px;height:${composition.height}px;opacity:0;pointer-events:none;`;
    stage.appendChild(staging);
    const nextHandle = mountComposition(staging, composition, {
      registry: this.registry,
      resolver: this.resolver,
      ...preview.options,
      contentDomain: this.contentDomainOf(preview.compositionKey, composition),
    });
    try {
      await nextHandle.ready;
      if (revision !== preview.swapRevision || !this.previews.has(preview) || preview.handle !== previousHandle) {
        nextHandle.destroy();
        staging.remove();
        return;
      }
      nextHandle.update(preview.options);
      const nextRoot = nextHandle.root;
      previousHandle.destroy();
      stage.replaceChildren(nextRoot);
      preview.handle = nextHandle;
      preview.mountedKey = preview.compositionKey;
      // Interactive comps (data-fd-interactive on the root) own their pointer events —
      // the Studio canvas overlay steps aside via this host class.
      preview.host.classList.toggle("framediff-interactive", nextRoot.hasAttribute("data-fd-interactive"));
      emitPreviewNodes(preview);
    } catch (error) {
      nextHandle.destroy();
      staging.remove();
      if (revision === preview.swapRevision) console.error("FrameDiff could not hot-swap the composition preview.", error);
    }
  }

  private renderPreview(preview: PreviewRecord): void {
    const composition = this.registry[preview.compositionKey];
    if (!composition) {
      const registryEmpty = Object.keys(this.registry).length === 0;
      preview.handle?.destroy();
      preview.handle = undefined;
      const message = document.createElement("div");
      message.style.cssText = "padding:24px;color:#a69e8d;font:12px/1.7 SFMono-Regular,Menlo,monospace;";
      message.textContent = registryEmpty || !preview.compositionKey
        ? "No compositions yet — add one under src/ and register it in COMPOSITIONS."
        : `Unknown composition "${preview.compositionKey}" — it may have been renamed or removed.`;
      preview.host.replaceChildren(message);
      return;
    }
    if (!this.assetsLoaded) {
      preview.handle?.destroy();
      preview.handle = undefined;
      preview.observer?.disconnect();
      const message = document.createElement("div");
      message.style.cssText = "padding:24px;color:#a69e8d;font:12px/1.7 SFMono-Regular,Menlo,monospace;";
      message.textContent = "Loading composition media…";
      preview.host.replaceChildren(message);
      return;
    }
    if (preview.handle && preview.mountedKey === preview.compositionKey) {
      preview.handle.update(preview.options);
      emitPreviewNodes(preview);
      return;
    }
    preview.handle?.destroy();
    preview.observer?.disconnect();
    const wrap = document.createElement("div");
    wrap.className = "ms-stagewrap";
    const box = document.createElement("div");
    box.className = "ms-stagebox";
    const stage = document.createElement("div");
    stage.className = "ms-stage";
    stage.style.width = `${composition.width}px`;
    stage.style.height = `${composition.height}px`;
    box.appendChild(stage);
    wrap.appendChild(box);
    preview.host.replaceChildren(wrap);
    const fit = () => {
      const bounds = wrap.getBoundingClientRect();
      const scale = bounds.width && bounds.height ? Math.min(bounds.width / composition.width, bounds.height / composition.height) : 0.4;
      box.style.width = `${composition.width * scale}px`;
      box.style.height = `${composition.height * scale}px`;
      stage.style.transform = `scale(${scale})`;
      emitPreviewNodes(preview);
    };
    fit();
    preview.observer = new ResizeObserver(fit);
    preview.observer.observe(wrap);
    preview.stage = stage;
    preview.handle = mountComposition(stage, composition, {
      registry: this.registry,
      resolver: this.resolver,
      ...preview.options,
      contentDomain: this.contentDomainOf(preview.compositionKey, composition),
    });
    preview.mountedKey = preview.compositionKey;
    preview.host.classList.toggle("framediff-interactive", preview.handle.root.hasAttribute("data-fd-interactive"));
    void preview.handle.ready.then(() => emitPreviewNodes(preview));
    emitPreviewNodes(preview);
  }

  /** Where the comp actually has material: its own domain [0, durationInFrames) extended to
   *  cover any clip staged outside it. Frames beyond this show/encode as black. */
  private contentDomainOf(compositionKey: string, composition: StudioComposition): { from: number; to: number } {
    let from = 0;
    let to = composition.durationInFrames;
    for (const item of this.probed.get(compositionKey) ?? []) {
      const length = Number.isFinite(item.durationInFrames)
        ? item.durationInFrames
        : Math.max(1, composition.durationInFrames - item.from);
      from = Math.min(from, item.from);
      to = Math.max(to, item.from + length);
    }
    return { from, to };
  }

  private async loadAssets(): Promise<void> {
    const manifest = await getAssets();
    if (!manifest) return;
    this.manifest = manifest as AssetManifest;
    this.resolver = createAssetResolver({
      manifest: this.manifest,
      cas: new HttpFolderCAS(),
      trustLocalCacheSources: true,
    });
  }

  private cacheForProbe(): Promise<CacheEntry[]> {
    if (!this.cacheProbe) {
      const current = listCache();
      this.cacheProbe = current;
      void current.finally(() => queueMicrotask(() => { if (this.cacheProbe === current) this.cacheProbe = null; }));
    }
    return this.cacheProbe;
  }

  private async nestedArtifactState(
    compositionKey: string,
    cache: CacheEntry[],
  ): Promise<{ artifactStatus: "current" | "stale" | "missing" | "remote"; pinnedTake?: number }> {
    const composition = this.registry[compositionKey];
    if (!composition) return { artifactStatus: "missing" };
    const take = "recipe" in composition && typeof (composition as GenerativeComposition).recipe.take === "number"
      ? (composition as GenerativeComposition).recipe.take
      : undefined;
    const artifacts = cache.filter((entry) => entry.meta?.compId === composition.id);
    if (!artifacts.length) return { artifactStatus: take != null ? "remote" : "missing", ...(take != null ? { pinnedTake: take } : {}) };
    const sources = await this.loadCompositionSources(compositionKey);
    const hashes = new Map(await Promise.all(Object.entries(sources).map(async ([file, text]) => [file, await hashString(text)] as const)));
    const current = artifacts.some((entry) => artifactStatusFromInputs(entry.meta?.inputs, hashes) === "current");
    return { artifactStatus: current ? "current" : "stale", ...(take != null ? { pinnedTake: take } : {}) };
  }

  private async loadCompositionSources(compositionKey: string): Promise<FileSet> {
    const composition = this.registry[compositionKey];
    if (!composition) return {};
    const paths = [
      composition.meta?.file,
      composition.meta?.module,
      ...(composition.meta?.deps ?? []),
      ...(composition.meta?.editableData ?? []).map((source) => source.file),
    ].filter((path): path is string => !!path);
    const entries = await Promise.all([...new Set(paths)].map(async (path) => [path, await readSource(path)] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] != null));
  }

  private async loadAllSources(): Promise<FileSet> {
    const paths = Object.values(this.registry).flatMap((composition) => [
      composition.meta?.file,
      composition.meta?.module,
      ...(composition.meta?.deps ?? []),
      ...(composition.meta?.editableData ?? []).map((source) => source.file),
    ]).filter((path): path is string => !!path);
    const registryFile = await this.findRegistryFile();
    if (registryFile) paths.push(registryFile);
    const entries = await Promise.all([...new Set(paths)].map(async (path) => [path, await readSource(path)] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] != null));
  }

  private async findRegistryFile(): Promise<string | null> {
    for (const candidate of ["src/config.ts", "src/compositions.ts", "src/main.ts"]) {
      const text = await readSource(candidate);
      if (text && /\bexport\s+const\s+COMPOSITIONS\b/.test(text)) return candidate;
    }
    return null;
  }
}

export function createStudioRuntime(registry: CompRegistry): HtmlStudioRuntime {
  return new HtmlStudioRuntime(registry);
}
