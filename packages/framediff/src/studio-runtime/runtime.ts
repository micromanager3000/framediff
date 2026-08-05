import type {
  AnimationCreateRequest,
  AnimationEditRequest,
  AnimationProbeSnapshot,
  AgentFrameSnapshot,
  CompositionBakeInputsSnapshot,
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
  PlanEditRequest,
  PlacementEditRequest,
  PlacementEditResult,
  PreviewElementEditRequest,
  PreviewHandle,
  PreviewNodeSnapshot,
  PreviewOptions,
  GenerativeChoiceSnapshot,
  ProviderCredentialsSnapshot,
  ProjectWorkspacePort,
  ProcessingCompositionDocument,
  ProcessingOperationResult,
  ProcessingWorkspaceSnapshot,
  RenderProgressSnapshot,
  RenderResult,
  ScriptSheetSnapshot,
  TimelineDeleteRequest,
  TimelineItemSnapshot,
  TimelineLaneSnapshot,
  TimelineShapeCreateRequest,
  UnrollGroupRequest,
  VisualAdaptation,
} from "@framediff/studio-model";
import {
  artifactStatusFromInputs,
  buildTimelineLanes,
  classifyVisualGeometry,
  cropRegionMatchesTargetAspect,
  normalizeCropRegion,
  fingerprintProcessingRecipe,
  RVM_PROCESSOR,
  validateProcessingArtifactManifest,
  validateProcessingRecipe,
  validateRvmArtifactManifest,
  retargetCropRegion,
} from "@framediff/studio-model";
import { createAssetResolver, type AssetResolver } from "../assets/resolver";
import type { AssetManifest } from "../graph/schemas";
import {
  parseNumericArrayProperty,
  parseObjectArray,
  parseObjectArrayStrings,
  rewriteLiteral,
  rewriteStringLiteral,
  findCompExportName,
  insertRegistryEntry,
  relModule,
  removeRegistryEntry,
  transformCopiedCompText,
  type FileSet,
  type LiteralLoc,
  type ResolvedExpr,
  type StringLiteralLoc,
} from "../studio/sourceMap";
import { latestFailedGenJob } from "../studio/devfs";
import {
  createHttpStudioProjectAdapter,
  type StudioProjectAdapter,
} from "../studio/projectAdapter";
import type { CacheEntry, CompRegistry, StudioComposition } from "../studio/types";
import { CAMERA3D_FIELD_KEYS } from "../studio/editableData";
import { inspectorFieldsFromJsonDocument, jsonPointerValue, setJsonPointerValue } from "../studio/jsonDocument";
import { downloadBuffer } from "../save";
import { hashBlob, hashString } from "../graph/hash";
import { camelName, kebabName, pascalName } from "../studio/compose";
import { remapRecipeForModel, rewriteRecipeSource, withRecipe } from "../studio/genSource";
import {
  DEFAULT_GEN_MODEL_BY_OUTPUT,
  GEN_MODELS,
  genModelOf,
  genModelsForOutput,
  genParamValue,
  genNumericParamValidationError,
  genRefAccept,
} from "../genModels";
import {
  genNativeDims,
  genOutputKindOf,
  genRecipeSnapshotOf,
  genRecipeDataOf,
  invalidateGenManifest,
  primeGenTakes,
  refreshGenOutputs,
  recipeHashOf,
  forkGenRecipe,
  type GenRecipe,
  type GenRef,
  type GenerativeComposition,
} from "../generative";
import type { ProcessingComposition } from "../processingComposition";
import {
  deletePlanRow,
  insertPlanRow,
  movePlanRow,
  parseScriptSheet,
  retimePlanRows,
  setPlanRowSource,
} from "../planning";
import { mountComposition, type CompositionHandle } from "../runtime";
import {
  defineComposition,
  defineTimelineDocument,
  type CompositionTimelineDocument,
  type CompositionTimelinePlacement,
} from "../composition";
import { parseMotionPathSvg } from "@framediff/studio-model";
import { getGsapRuntimeTraces } from "../gsap/traces";
import {
  findHtmlElementById,
  htmlGradeAttributes,
  inspectorFieldsFromHtml,
  insertNestedHtmlComposition,
  removeHtmlAttribute,
  removeHtmlElement,
  rewriteHtmlAttribute,
  rewriteHtmlAttributes,
  timelineFromComposition,
  timelineFromHtml,
} from "../studio/htmlSource";
import "./preview.css";

let gsapSourcePromise: Promise<typeof import("../gsap/source")> | undefined;
const loadGsapSource = () => (gsapSourcePromise ??= import("../gsap/source"));

let videoExporterPromise: Promise<typeof import("../render/exportVideo")> | undefined;
const loadVideoExporter = () => (videoExporterPromise ??= import("../render/exportVideo"));

let frameCapturePromise: Promise<typeof import("../render/captureComposite")> | undefined;
const loadFrameCapture = () => (frameCapturePromise ??= import("../render/captureComposite"));

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

const appendJsonPointer = (base: string, property: string): string =>
  `${base}/${property.replaceAll("~", "~0").replaceAll("/", "~1")}`;

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

function offsetWithinRoot(element: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cursor: HTMLElement | null = element;
  const seen = new Set<HTMLElement>();
  while (cursor && cursor !== root && !seen.has(cursor)) {
    seen.add(cursor);
    x += cursor.offsetLeft;
    y += cursor.offsetTop;
    cursor = cursor.offsetParent instanceof HTMLElement ? cursor.offsetParent : cursor.parentElement;
  }
  return { x, y };
}

function previewElement(preview: PreviewRecord, element: HTMLElement): PreviewNodeSnapshot | null {
  const root = preview.handle?.root;
  const objectId = element.getAttribute("data-fd-id");
  if (
    !root
    || !objectId
    || element === root
    || element instanceof HTMLAudioElement
    || element.getAttribute("data-fd-output-kind") === "audio"
    || element.closest("[data-fd-composition]") !== root
  ) return null;
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
  const materializedLayout = element.getAttribute("data-fd-layout-space") === "composition"
    && element.hasAttribute("data-fd-x")
    && element.hasAttribute("data-fd-y");
  const offset = offsetWithinRoot(element, root);
  return {
    ref: { compositionKey: preview.compositionKey, objectId, kind: "element" },
    tagName: element.tagName.toLowerCase(),
    label: element.getAttribute("data-fd-name") ?? objectId,
    ...(parent && parent !== root ? { parentId: parent.getAttribute("data-fd-id") ?? undefined } : {}),
    ...(owner?.getAttribute("data-fd-id") ? { ownerItemId: owner.getAttribute("data-fd-id")! } : {}),
    ...(compRef ? { nestedCompositionKey: compRef } : {}),
    bounds: {
      x: materializedLayout ? previewNumeric(element, "data-fd-x", 0) : offset.x + previewNumeric(element, "data-fd-x", 0),
      y: materializedLayout ? previewNumeric(element, "data-fd-y", 0) : offset.y + previewNumeric(element, "data-fd-y", 0),
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
    movable: element.getAttribute("data-fd-layout-owner") === "timeline" || element.hasAttribute("data-fd-x") || element.hasAttribute("data-fd-y"),
    resizable: element.getAttribute("data-fd-layout-owner") === "timeline" || element.hasAttribute("data-fd-width") || element.hasAttribute("data-fd-height"),
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
  const authoredX = previewNumeric(element, "data-fd-x", 0);
  const authoredY = previewNumeric(element, "data-fd-y", 0);
  const localX = previewNumeric(element, "data-fd-layout-local-x", authoredX);
  const localY = previewNumeric(element, "data-fd-layout-local-y", authoredY);
  const scale = previewNumeric(element, "data-fd-scale", 1);
  const rotation = previewNumeric(element, "data-fd-rotation", 0);
  element.style.transform = `translate(${localX + x - authoredX}px, ${localY + y - authoredY}px) rotate(${rotation}deg) scale(${scale})`;
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

function parsedTimelineDocument(text: string): CompositionTimelineDocument {
  return structuredClone(defineTimelineDocument(JSON.parse(text)));
}

function timelinePlacementKind(
  placement: CompositionTimelinePlacement,
  fallback?: TimelineItemSnapshot,
  registry?: CompRegistry,
): TimelineLaneSnapshot["kind"] {
  const type = placement.content?.type ?? fallback?.content.type;
  const compositionRef = placement.content?.type === "nested"
    ? placement.content.composition
    : fallback?.content.type === "nested"
      ? fallback.content.compId
      : undefined;
  const nestedKey = compositionRef && registry ? resolveCompositionKey(registry, compositionRef) : undefined;
  if (nestedKey && registry?.[nestedKey]?.meta?.output === "audio") return "audio";
  return type === "audio" ? "audio" : type === "grade-layer" ? "grade" : "video";
}

function placementsOverlap(left: CompositionTimelinePlacement, right: CompositionTimelinePlacement): boolean {
  return left.from < right.from + right.durationInFrames && right.from < left.from + left.durationInFrames;
}

const GRADE_PRESETS: Record<string, { label: string; values: Record<string, number> }> = {
  neutral: { label: "Neutral", values: { exposure: 0, contrast: 0, saturation: 1, temperature: 0, vignette: 0 } },
  "kodak-2383": { label: "Kodak 2383", values: { temperature: 0.18, contrast: 0.14, saturation: 1.08, vignette: 0.24 } },
  "portra-400": { label: "Portra 400", values: { temperature: 0.24, tint: 0.03, contrast: 0.08, saturation: 1.16, vignette: 0.14 } },
  "teal-orange": { label: "Teal & Orange", values: { temperature: -0.35, tint: 0.05, contrast: 0.12, saturation: 1.15, vignette: 0.42 } },
  moonlit: { label: "Moonlit", values: { exposure: -0.12, temperature: -0.28, contrast: 0.18, saturation: 0.82, vignette: 0.36 } },
};

type HtmlCompositionScaffoldOptions = {
  id: string;
  exportName: string;
  file: string;
  module: string;
  documentFile: string;
  schemaFile: string;
  timelineFile?: string;
  kind: NewCompositionRequest["kind"];
  width: number;
  height: number;
  fps: number;
  duration: number;
};

type CompositionScaffoldData = {
  document: Record<string, unknown>;
  schema: Record<string, unknown>;
  bindings: Record<string, string>;
  timeline?: CompositionTimelineDocument;
};

const textObjectSchema = (title: string, extra: Record<string, unknown> = {}) => ({
  type: "object",
  title,
  properties: {
    text: { type: "string", title: "Text" },
    ...extra,
  },
});

function compositionScaffoldData(options: HtmlCompositionScaffoldOptions): CompositionScaffoldData {
  const title = { text: options.id, color: "#f7f3e8" };
  const titleSchema = textObjectSchema("Title", { color: { type: "string", title: "Color", format: "color" } });
  if (options.kind === "edit" || options.kind === "scene") {
    return {
      document: {
        title: {
          ...title,
          x: Math.round(options.width * 0.1),
          y: Math.round(options.height * 0.4),
          width: Math.round(options.width * 0.8),
          fontSize: Math.round(options.width * 0.075),
          textAlign: "center",
          opacity: 1,
        },
      },
      schema: {
        type: "object",
        properties: {
          title: textObjectSchema("Title", {
            x: { type: "number", title: "X" }, y: { type: "number", title: "Y" },
            width: { type: "number", title: "Width", minimum: 80 },
            fontSize: { type: "number", title: "Font size", minimum: 8, maximum: 240, "x-ui": "slider" },
            color: { type: "string", title: "Color", format: "color" },
            textAlign: { type: "string", title: "Align", enum: ["left", "center", "right"] },
            opacity: { type: "number", title: "Opacity", minimum: 0, maximum: 1, step: 0.01, "x-ui": "slider" },
          }),
        },
      },
      bindings: { "title-text": "/title" },
      ...(options.kind === "edit" ? {
        timeline: { version: 1 as const, items: [{ id: "title", from: 0, durationInFrames: options.duration, layer: 0 }] },
      } : {}),
    };
  }
  if (options.kind === "audio") {
    return {
      document: { audio: { src: "/audio.mp3", volume: 1, muted: false } },
      schema: {
        type: "object",
        properties: {
          audio: {
            type: "object", title: "Audio", properties: {
              src: { type: "string", title: "Asset", format: "asset" },
              volume: { type: "number", title: "Volume", minimum: 0, maximum: 1, step: 0.01, "x-ui": "slider" },
              muted: { type: "boolean", title: "Muted" },
            },
          },
        },
      },
      bindings: { audio: "/audio" },
      timeline: { version: 1, items: [{ id: "audio", from: 0, durationInFrames: options.duration, layer: 0 }] },
    };
  }
  if (options.kind === "3d") {
    return {
      document: { scene: { background: "#111827", opacity: 1, intensity: 1 } },
      schema: {
        type: "object", properties: {
          scene: {
            type: "object", title: "Scene", properties: {
              background: { type: "string", title: "Background", format: "color" },
              opacity: { type: "number", title: "Opacity", minimum: 0, maximum: 1, step: 0.01, "x-ui": "slider" },
              intensity: { type: "number", title: "Intensity", minimum: 0, maximum: 4, step: 0.05, "x-ui": "slider" },
            },
          },
        },
      },
      bindings: { scene: "/scene" },
    };
  }
  if (options.kind === "plan") {
    const third = Math.max(1, Math.round(options.duration / 3));
    return {
      document: {
        title,
        row1: { text: "Describe the opening beat." },
        row2: { text: "Describe the middle beat." },
        row3: { text: "Describe the closing beat." },
      },
      schema: {
        type: "object", properties: {
          title: titleSchema,
          row1: textObjectSchema("Opening"), row2: textObjectSchema("Middle"), row3: textObjectSchema("Closing"),
        },
      },
      bindings: { "plan-title": "/title", "row-1-text": "/row1", "row-2-text": "/row2", "row-3-text": "/row3" },
      timeline: {
        version: 1,
        items: [
          { id: "row-1", from: 0, durationInFrames: third, layer: 0 },
          { id: "row-2", from: third, durationInFrames: third, layer: 0 },
          { id: "row-3", from: third * 2, durationInFrames: Math.max(1, options.duration - third * 2), layer: 0 },
        ],
      },
    };
  }
  if (["board", "moodboard"].includes(options.kind)) {
    return {
      document: {
        title,
        card1: { text: "First idea", x: Math.round(options.width * 0.1), y: Math.round(options.height * 0.28), width: Math.round(options.width * 0.22), height: Math.round(options.height * 0.3), background: "#293047", borderRadius: 18 },
        card2: { text: "Second idea", x: Math.round(options.width * 0.39), y: Math.round(options.height * 0.35), width: Math.round(options.width * 0.22), height: Math.round(options.height * 0.3), background: "#3d2851", borderRadius: 18 },
        card3: { text: "Third idea", x: Math.round(options.width * 0.68), y: Math.round(options.height * 0.25), width: Math.round(options.width * 0.22), height: Math.round(options.height * 0.3), background: "#174840", borderRadius: 18 },
      },
      schema: {
        type: "object", properties: {
          title: titleSchema,
          ...Object.fromEntries([1, 2, 3].map((index) => [`card${index}`, textObjectSchema(`Card ${index}`, {
            x: { type: "number", title: "X" }, y: { type: "number", title: "Y" },
            width: { type: "number", title: "Width", minimum: 80 }, height: { type: "number", title: "Height", minimum: 60 },
            background: { type: "string", title: "Color", format: "color" },
            borderRadius: { type: "number", title: "Corner radius", minimum: 0, maximum: 80, "x-ui": "slider" },
          })])),
        },
      },
      bindings: { "board-title": "/title", "card-1": "/card1", "card-2": "/card2", "card-3": "/card3" },
    };
  }
  return {
    document: { title, body: { text: "Start authoring here." } },
    schema: { type: "object", properties: { title: titleSchema, body: textObjectSchema("Body") } },
    bindings: { "document-title": "/title", "document-body": "/body" },
  };
}

function htmlCompositionScaffold(options: HtmlCompositionScaffoldOptions): string {
  if (options.kind === "plan") return planCompositionScaffold(options);
  const webGpu = options.kind === "3d" ? `
    <canvas data-fd-id="scene" data-fd-name="Scene" data-fd-type="layers" data-fd-webgpu></canvas>` : "";
  const board = ["board", "moodboard"].includes(options.kind)
    ? `\n    <h1 class="board-title" data-fd-id="board-title"></h1>
    <section class="card" data-fd-id="card-1"></section>
    <section class="card" data-fd-id="card-2"></section>
    <section class="card" data-fd-id="card-3"></section>`
    : "";
  const content = options.kind === "audio"
    ? `\n    <section class="audio-surface"><h1>${options.id}</h1><p>Select the audio clip to choose an asset and set its level.</p></section><audio data-fd-clip data-fd-id="audio" data-fd-type="audio"></audio>`
    : webGpu || (options.kind === "edit" ? `\n    <section data-fd-clip data-fd-id="title" data-fd-name="Title">
      <h1 class="canvas-title" data-fd-id="title-text"></h1>
    </section>` : board || `\n    <section class="document" data-fd-id="content" data-fd-name="Content">
      <h1 data-fd-id="document-title"></h1>
      <p data-fd-id="document-body"></p>
    </section>`);
  return `<!doctype html>
<html>
<head>
  <style>
    [data-fd-composition] { position: relative; overflow: hidden; background: #111; color: white; font-family: system-ui, sans-serif; }
    [data-fd-clip] { position: absolute; inset: 0; display: grid; place-items: center; }
    .document { position: absolute; inset: 0; display: grid; place-content: center; gap: 20px; text-align: center; }
    .document p { color: #aaa; font-size: 24px; }
    .canvas-title { position: absolute; left: 0; top: 0; margin: 0; }
    .board-title { position: absolute; left: 7%; top: 8%; margin: 0; font-size: 48px; }
    .card { position: absolute; left: 0; top: 0; box-sizing: border-box; display: grid; place-items: center; padding: 24px; font-size: 28px; box-shadow: 0 22px 60px #0008; }
    .audio-surface { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
    .audio-surface p { color: #aaa; }
    h1 { font-size: 72px; margin: 0; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <main data-fd-composition data-fd-id="${options.id}"
    data-fd-width="${options.width}" data-fd-height="${options.height}"
    data-fd-fps="${options.fps}" data-fd-duration="${options.duration}"
    data-fd-kind="${options.kind}" data-fd-source="${options.file}"
    data-fd-module="${options.module}" data-fd-export="${options.exportName}"
    data-fd-document="${options.documentFile}" data-fd-schema="${options.schemaFile}"${options.timelineFile ? ` data-fd-timeline-source="${options.timelineFile}"` : ""}>${content}
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
 * Custom comps deliberately own only source. They have a render clock and can nest anything in
 * the registry, but they do not get an implicit JSON document or a private timeline.
 */
function customCompositionScaffold(options: HtmlCompositionScaffoldOptions): string {
  return `<!doctype html>
<html>
<head>
  <style>
    [data-fd-composition] {
      position: relative;
      overflow: hidden;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 78% 20%, rgba(103, 232, 249, .16), transparent 32%),
        linear-gradient(145deg, #111827, #090b11 64%);
      color: #f8fafc;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .custom-card {
      width: min(72%, 860px);
      padding: 52px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 28px;
      background: rgba(15,23,42,.72);
      box-shadow: 0 28px 90px rgba(0,0,0,.36);
      transform: translateY(calc(sin(var(--custom-time, 0)) * 8px));
    }
    .eyebrow { margin: 0 0 14px; color: #67e8f9; font: 750 13px/1 ui-monospace, monospace; letter-spacing: .16em; }
    h1 { margin: 0; font-size: clamp(52px, 7vw, 104px); line-height: .95; letter-spacing: -.055em; }
    .description { max-width: 680px; margin: 24px 0 0; color: #a9b5c7; font-size: 20px; line-height: 1.55; }
    .frame-readout { margin-top: 34px; color: #7d8ba3; font: 650 14px/1 ui-monospace, monospace; letter-spacing: .08em; }
    .frame-readout b { color: #f8fafc; font-size: 24px; }
    .progress { height: 3px; margin-top: 16px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.09); }
    .progress::after { content: ""; display: block; width: calc(var(--custom-progress, 0) * 100%); height: 100%; background: #67e8f9; }
  </style>
</head>
<body>
  <main data-fd-composition data-fd-id="${options.id}"
    data-fd-width="${options.width}" data-fd-height="${options.height}"
    data-fd-fps="${options.fps}" data-fd-duration="${options.duration}"
    data-fd-kind="custom" data-fd-timeline="hidden" data-fd-transport="always"
    data-fd-source="${options.file}" data-fd-module="${options.module}" data-fd-export="${options.exportName}">
    <section class="custom-card" data-fd-id="custom-card" data-fd-name="Custom content">
      <p class="eyebrow">CUSTOM · SOURCE OWNED</p>
      <h1 data-fd-id="custom-title">${options.id}</h1>
      <p class="description">Author any HTML, CSS, and JavaScript here. When this comp is placed in an edit, its render-local frame is supplied to the same callback in preview and export.</p>
      <div class="frame-readout">FRAME <b>0000</b></div>
      <div class="progress"></div>
    </section>
    <!-- To reference another registered comp, add an element with
         data-fd-type="nested" and data-fd-comp="its-registry-key". -->
    <script>
      const frameReadout = query(".frame-readout b");
      onFrame(({ frame, time, playing, fps, durationInFrames }) => {
        frameReadout.textContent = String(Math.floor(frame)).padStart(4, "0");
        root.dataset.playing = String(playing);
        root.style.setProperty("--custom-time", String(time));
        root.style.setProperty("--custom-progress", String(frame / Math.max(1, durationInFrames - 1)));
        root.style.setProperty("--custom-fps", String(fps));
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
function planCompositionScaffold(options: HtmlCompositionScaffoldOptions): string {
  const rows = [
    { id: "row-1", name: "1 · Opening" },
    { id: "row-2", name: "2 · Middle" },
    { id: "row-3", name: "3 · Closing" },
  ];
  const rowMarkup = rows.map((row) => `    <section class="row" data-fd-clip data-fd-id="${row.id}" data-fd-name="${row.name}">
      <div class="when"></div>
      <p data-fd-id="${row.id}-text"></p>
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
    data-fd-module="${options.module}" data-fd-export="${options.exportName}"
    data-fd-document="${options.documentFile}" data-fd-schema="${options.schemaFile}"
    data-fd-timeline-source="${options.timelineFile}">
    <h1 data-fd-id="plan-title"></h1>
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

function htmlCompositionModule(
  htmlFile: string,
  exportName: string,
  options: {
    setupImport?: string;
    documentFile?: string;
    schemaFile?: string;
    bindings?: Record<string, string>;
    timelineFile?: string;
  } = {},
): string {
  const fileName = htmlFile.split("/").pop()!;
  const directory = htmlFile.split("/").slice(0, -1).join("/") || ".";
  const localImport = (file: string): string => {
    const relative = file.startsWith(`${directory}/`) ? file.slice(directory.length + 1) : file;
    return relative.startsWith(".") ? relative : `./${relative}`;
  };
  const documentImport = options.documentFile ? `import document from ${JSON.stringify(localImport(options.documentFile))};\n` : "";
  const timelineImport = options.timelineFile ? `import timeline from ${JSON.stringify(localImport(options.timelineFile))};\n` : "";
  const defineOptions = options.documentFile || options.timelineFile || options.setupImport
    ? `, {${options.setupImport ? " setup: sourceComposition.setup," : ""}${options.documentFile ? ` document, meta: { document: { file: ${JSON.stringify(options.documentFile)},${options.schemaFile ? ` schema: ${JSON.stringify(options.schemaFile)},` : ""} bindings: ${JSON.stringify(options.bindings ?? {})} }${options.timelineFile ? `, timelineFile: ${JSON.stringify(options.timelineFile)}` : ""} },` : options.timelineFile ? ` meta: { timelineFile: ${JSON.stringify(options.timelineFile)} },` : ""}${options.timelineFile ? " timeline," : ""} }`
    : "";
  return `import { defineComposition${options.timelineFile ? ", defineTimelineDocument" : ""} } from "framediff";
import source from "./${fileName}?raw";
${documentImport}${timelineImport}${options.setupImport ? `${options.setupImport}\n` : ""}
${options.timelineFile ? "const timelineDocument = defineTimelineDocument(timeline);\n" : ""}export const ${exportName} = defineComposition(source${options.timelineFile ? defineOptions.replace(" timeline,", " timeline: timelineDocument,") : defineOptions});
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
  dataFile: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}): string {
  const directory = options.file.split("/").slice(0, -1).join("/") || ".";
  const dataImport = options.dataFile.startsWith(`${directory}/`)
    ? `./${options.dataFile.slice(directory.length + 1)}`
    : options.dataFile;
  return `import { generative, type GenRecipeData } from "framediff";
import data from ${JSON.stringify(dataImport)};

export const ${options.exportName} = generative({
  id: ${JSON.stringify(options.id)},
  file: ${JSON.stringify(options.file)},
  dataFile: ${JSON.stringify(options.dataFile)},
  ...(data as GenRecipeData),
});
`;
}

function processingCompositionModule(options: {
  id: string;
  exportName: string;
  file: string;
  dataFile: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}): string {
  const directory = options.file.split("/").slice(0, -1).join("/") || ".";
  const dataImport = options.dataFile.startsWith(`${directory}/`)
    ? `./${options.dataFile.slice(directory.length + 1)}`
    : options.dataFile;
  return `import { processing, type ProcessingCompositionDocument } from "framediff";
import document from ${JSON.stringify(dataImport)};

export const ${options.exportName} = processing({
  id: ${JSON.stringify(options.id)},
  file: ${JSON.stringify(options.file)},
  dataFile: ${JSON.stringify(options.dataFile)},
  width: ${options.width},
  height: ${options.height},
  fps: ${options.fps},
  durationInFrames: ${options.durationInFrames},
  document: document as ProcessingCompositionDocument,
});
`;
}

function moodboardCompositionModule(options: {
  id: string;
  exportName: string;
  file: string;
  documentFile: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}): string {
  const directory = options.file.split("/").slice(0, -1).join("/") || ".";
  const documentImport = options.documentFile.startsWith(`${directory}/`)
    ? `./${options.documentFile.slice(directory.length + 1)}`
    : options.documentFile;
  return `import { defineMoodboardComposition, type MoodboardData } from "framediff";
import document from ${JSON.stringify(documentImport)};

export const ${options.exportName} = defineMoodboardComposition(document as MoodboardData, {
  id: ${JSON.stringify(options.id)},
  title: ${JSON.stringify(options.id)},
  width: ${options.width},
  height: ${options.height},
  fps: ${options.fps},
  durationInFrames: ${options.durationInFrames},
  dataFile: ${JSON.stringify(options.documentFile)},
  file: ${JSON.stringify(options.file)},
  module: ${JSON.stringify(options.file)},
  exportName: ${JSON.stringify(options.exportName)},
});
`;
}

function ownCompositionSourcePaths(composition: StudioComposition): string[] {
  return [
    composition.meta?.file,
    composition.meta?.module,
    composition.meta?.timelineFile,
    composition.meta?.document?.file,
    ...(composition.meta?.deps ?? []),
    ...(composition.meta?.editableData ?? []).map((source) => source.file),
  ].filter((file): file is string => !!file);
}

function resolveCompositionKey(registry: CompRegistry, reference: string): string | undefined {
  if (registry[reference]) return reference;
  return Object.entries(registry).find(([, candidate]) => candidate.id === reference)?.[0];
}

/** The composition and every nested or generative-input composition that contributes pixels. */
export function compositionRenderKeys(registry: CompRegistry, compositionKey: string): string[] {
  const visited = new Set<string>();
  const keys: string[] = [];
  const visit = (key: string): void => {
    if (visited.has(key) || !registry[key]) return;
    visited.add(key);
    keys.push(key);
    for (const child of childCompositionKeys(registry, registry[key])) visit(child);
  };
  visit(compositionKey);
  return keys;
}

/**
 * Render fingerprints follow the composition graph. A parent includes every nested composition's
 * render inputs, while unrelated compositions and editor-only schemas remain outside the hash.
 */
export function compositionSourcePaths(registry: CompRegistry, compositionKey: string): string[] {
  return [...new Set(compositionRenderKeys(registry, compositionKey)
    .flatMap((key) => ownCompositionSourcePaths(registry[key])))];
}

/** Asset IDs whose exact content contributes to this composition's rendered tree. */
export function compositionAssetIds(registry: CompRegistry, compositionKey: string): string[] {
  const assets: string[] = [];
  for (const key of compositionRenderKeys(registry, compositionKey)) {
    const composition = registry[key];
    try {
      for (const item of timelineFromComposition(composition)) {
        const content = item.content;
        const source = content.type === "video" || content.type === "audio" ? content.src : undefined;
        if (source?.startsWith("asset://")) assets.push(source.slice("asset://".length));
      }
    } catch {
      // probe() reports malformed source; missing render inputs are surfaced by bake itself.
    }
    if ("recipe" in composition) {
      for (const ref of (composition as GenerativeComposition).recipe.refs ?? []) {
        if (ref.src.startsWith("asset://")) assets.push(ref.src.slice("asset://".length));
      }
    }
  }
  return [...new Set(assets)];
}

async function compositionRuntimeHash(composition: StudioComposition): Promise<string> {
  const renderState = {
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
    html: composition.html,
    document: composition.document,
    timeline: composition.timeline,
    recipe: "recipe" in composition ? (composition as GenerativeComposition).recipe : undefined,
    setup: composition.setup ? String(composition.setup) : undefined,
    output: composition.meta?.output,
    outputFrame: composition.meta?.outputFrame,
    render: composition.meta?.render,
    alpha: composition.meta?.alpha,
  };
  return hashString(JSON.stringify(renderState));
}

export function isDocumentOnlyCompositionUpdate(
  before: StudioComposition | undefined,
  after: StudioComposition | undefined,
): boolean {
  return !!before
    && !!after
    && before.document !== after.document
    && after.meta?.document?.hotUpdate !== "remount"
    && before.html === after.html
    && (before.setup === after.setup || String(before.setup) === String(after.setup))
    && before.width === after.width
    && before.height === after.height
    && before.fps === after.fps
    && before.durationInFrames === after.durationInFrames
    && JSON.stringify(before.timeline) === JSON.stringify(after.timeline);
}

function runtimeJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function ownCompositionRuntimeEqual(before: StudioComposition | undefined, after: StudioComposition | undefined): boolean {
  return !!before
    && !!after
    && before.id === after.id
    && before.html === after.html
    && (before.setup === after.setup || String(before.setup) === String(after.setup))
    && before.width === after.width
    && before.height === after.height
    && before.fps === after.fps
    && before.durationInFrames === after.durationInFrames
    && runtimeJsonEqual(before.document, after.document)
    && runtimeJsonEqual(before.timeline, after.timeline)
    && runtimeJsonEqual("recipe" in before ? before.recipe : undefined, "recipe" in after ? after.recipe : undefined);
}

function childCompositionKeys(registry: CompRegistry, composition: StudioComposition | undefined): string[] {
  if (!composition) return [];
  const children: string[] = [];
  try {
    for (const item of timelineFromComposition(composition)) {
      const content = item.content;
      if (content.type !== "nested") continue;
      const child = resolveCompositionKey(registry, content.compId);
      if (child) children.push(child);
    }
  } catch {
    // probe() owns source diagnostics; an unreadable tree simply cannot be considered equal.
  }
  if ("recipe" in composition) {
    for (const ref of (composition as GenerativeComposition).recipe.refs ?? []) {
      if (!ref.src.startsWith("comp://")) continue;
      const reference = ref.src.slice("comp://".length);
      const child = resolveCompositionKey(registry, reference);
      if (child) children.push(child);
    }
  }
  return [...new Set(children)].sort();
}

/** True when this comp and every comp it renders are unchanged across a registry HMR update. */
export function isCompositionTreeRuntimeEqual(
  beforeRegistry: CompRegistry,
  afterRegistry: CompRegistry,
  compositionKey: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(compositionKey)) return true;
  visited.add(compositionKey);
  const before = beforeRegistry[compositionKey];
  const after = afterRegistry[compositionKey];
  if (!ownCompositionRuntimeEqual(before, after)) return false;
  const beforeChildren = childCompositionKeys(beforeRegistry, before);
  const afterChildren = childCompositionKeys(afterRegistry, after);
  if (beforeChildren.length !== afterChildren.length || beforeChildren.some((key, index) => key !== afterChildren[index])) return false;
  return beforeChildren.every((key) => isCompositionTreeRuntimeEqual(beforeRegistry, afterRegistry, key, visited));
}

function descendantCompositionTreesEqual(
  beforeRegistry: CompRegistry,
  afterRegistry: CompRegistry,
  before: StudioComposition,
  after: StudioComposition,
): boolean {
  const beforeChildren = childCompositionKeys(beforeRegistry, before);
  const afterChildren = childCompositionKeys(afterRegistry, after);
  return beforeChildren.length === afterChildren.length
    && beforeChildren.every((key, index) => key === afterChildren[index]
      && isCompositionTreeRuntimeEqual(beforeRegistry, afterRegistry, key));
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
    timelineDocument: !!composition.meta?.timelineFile,
    sources: compositionSourcePaths(registry, key),
    library: composition.meta?.library,
    render: composition.meta?.render,
    guide: composition.meta?.guide,
    authoring: composition.meta?.authoring,
  }));
}

const escapeAttribute = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("\"", "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function adaptedVisualComposition(options: {
  id: string;
  src: string;
  kind: "image" | "video";
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  adaptation: VisualAdaptation;
}): StudioComposition {
  const crop = options.adaptation.fit === "cover" && options.adaptation.crop
    ? normalizeCropRegion(options.adaptation.crop)
    : undefined;
  const mediaStyle = crop
    ? `left:${-(crop.x / crop.width) * 100}%;top:${-(crop.y / crop.height) * 100}%;width:${100 / crop.width}%;height:${100 / crop.height}%;object-fit:fill;`
    : options.adaptation.fit === "contain"
      ? "object-fit:contain;"
      : options.adaptation.fit === "stretch" || options.adaptation.fit === "resize"
        ? "object-fit:fill;"
        : "object-fit:cover;";
  const matte = /^#[0-9a-f]{6}$/i.test(options.adaptation.matte ?? "")
    ? options.adaptation.matte
    : "#000000";
  const media = options.kind === "image"
    ? `<img data-fd-type="image" data-fd-src="${escapeAttribute(options.src)}" alt="" style="${mediaStyle}">`
    : `<video data-fd-type="video" data-fd-src="${escapeAttribute(options.src)}" data-fd-muted="false" style="${mediaStyle}"></video>`;
  return defineComposition(`<!doctype html><html><head><style>
    [data-fd-composition]{position:relative;overflow:hidden;background:${matte}}
    img,video{position:absolute;inset:0;width:100%;height:100%}
  </style></head><body><main data-fd-composition data-fd-id="${escapeAttribute(options.id)}"
    data-fd-width="${options.width}" data-fd-height="${options.height}"
    data-fd-fps="${options.fps}" data-fd-duration="${options.durationInFrames}">
    ${media}
  </main></body></html>`, {
    meta: { kind: "generate", output: options.kind, sourceFormat: "generated" },
  });
}

// Takes this session has already announced to mounted GenOutputs — new arrivals beyond
// this set trigger a refreshGenOutputs() so playing previews pick them up live.
const seenGenTakes = new Set<string>();

export class HtmlStudioRuntime implements CompositionRuntimePort {
  public renderExecutionMode: "local" | "remote" = "local";
  public listProjectRenders?: ProjectWorkspacePort["listProjectRenders"];
  public downloadProjectRender?: ProjectWorkspacePort["downloadProjectRender"];
  public retryProjectRender?: ProjectWorkspacePort["retryProjectRender"];
  public cancelProjectRender?: ProjectWorkspacePort["cancelProjectRender"];
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
  private bakeInputListeners = new Set<() => void>();
  private cacheProbe: Promise<CacheEntry[]> | null = null;
  private outputResolutions = new Map<string, Promise<string>>();

  public constructor(
    registry: CompRegistry,
    private readonly project: StudioProjectAdapter = createHttpStudioProjectAdapter(),
  ) {
    this.registry = registry;
    this.assetsReady = this.loadAssets()
      .catch((error) => console.error("FrameDiff could not load the asset manifest.", error))
      .finally(() => {
        this.assetsLoaded = true;
        for (const preview of this.previews) this.renderPreview(preview);
      });
  }

  private voiceAnchoredRecipe(recipe: GenRecipe): GenRecipe {
    if (!(recipe.model ?? "").startsWith("elevenlabs") || recipe.voice?.trim()) return recipe;
    const anchorRef = (recipe.refs ?? []).find((ref) =>
      ref.kind === "audio" && ref.src.startsWith("comp://")
    );
    if (!anchorRef) return recipe;
    const reference = anchorRef.src.slice("comp://".length);
    const anchorKey = resolveCompositionKey(this.registry, reference);
    const anchor = anchorKey ? this.registry[anchorKey] : undefined;
    const voice = anchor && "recipe" in anchor
      ? (anchor as GenerativeComposition).recipe.voice?.trim()
      : undefined;
    return voice ? { ...recipe, voice } : recipe;
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

  public subscribeBakeInputChanges(listener: () => void): () => void {
    this.bakeInputListeners.add(listener);
    return () => this.bakeInputListeners.delete(listener);
  }

  public async replayProjectEdit(receipt: ProjectEditReceipt, direction: "undo" | "redo"): Promise<ProjectEditResult> {
    const target = direction === "undo" ? receipt.before : receipt.after;
    const expected = new Map((direction === "undo" ? receipt.after : receipt.before).map((entry) => [entry.file, entry.hash]));
    const result = await this.project.applySourceEdit({
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
    const result = await this.project.applySourceEdit({
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

  private async commitSourceTexts(
    label: string,
    changes: Array<{ before: { file: string; text: string | null; hash: string | null }; text: string | null }>,
    groupId?: string,
  ): Promise<ProjectEditResult> {
    const result = await this.project.applySourceEdit({
      label,
      ...(groupId ? { groupId } : {}),
      files: changes.map(({ before, text }) => ({ file: before.file, expectedHash: before.hash, text })),
    });
    if (!result.ok || !result.receipt) {
      return { ok: false, conflicts: result.conflicts, message: result.error ?? "Could not commit the source transaction." };
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
      if (isCompositionTreeRuntimeEqual(previous, registry, preview.compositionKey)) continue;
      const canPatchDocument = preview.handle
        && preview.mountedKey === preview.compositionKey
        && isDocumentOnlyCompositionUpdate(before, after)
        && before
        && after
        && descendantCompositionTreesEqual(previous, registry, before, after);
      if (canPatchDocument) {
        preview.handle!.updateDocument(after.document);
        emitPreviewNodes(preview);
        continue;
      }
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
      ? await this.project.readSource(composition.meta.file)
      : null;
    // Do not wait for Vite HMR to make an accepted source transaction inspectable. The registry
    // remains the preview authority, while the derived project view reads the just-committed HTML.
    const inspectable = physicalSource == null ? composition : { ...composition, html: physicalSource };
    const rawItems = timelineFromComposition(inspectable);
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
        ? resolveCompositionKey(this.registry, content.compId)
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
      const documentBinding = this.documentBinding(composition, item.id);
      const documentOwnsDuration = typeof documentBinding?.value.durationInFrames === "number";
      return composition.meta?.sourceFormat === "generated"
        ? { ...item, production, editable: { from: false, duration: documentOwnsDuration, layer: false, trimStart: false } }
        : { ...item, production };
    }));
    this.probed.set(compositionKey, latest);
    return latest;
  }

  public async probeAnimations(compositionKey: string): Promise<AnimationProbeSnapshot> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    const { analyzeGsapSource, analyzeGsapUnrollGroups } = await loadGsapSource();
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
      const handle = mountComposition(host, composition, {
        registry: this.registry,
        resolver: this.resolver,
        resolveCompositionOutput: this.resolveCompositionOutput,
        frame: 0,
        playing: false,
      });
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
    const revision = await this.project.readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const { rewriteGsapUnrollSource } = await loadGsapSource();
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
    const { analyzeGsapSource, rewriteGsapAnimationSource } = await loadGsapSource();
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
    const revision = await this.project.readSourceRevision(file);
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
    if (!composition || !file) return { ok: false, message: "This composition needs an authored source module before a stopwatch can be enabled." };
    const revision = await this.project.readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const id = `${request.objectId}-${request.property}`.replace(/[^A-Za-z0-9_-]+/g, "-");
    const { ensureGsapTimelineSource, insertGsapTweenSource } = await loadGsapSource();
    const prepared = ensureGsapTimelineSource(revision.text, {
      fps: composition.fps,
      file,
      exportName: composition.meta?.exportName,
    });
    if (!prepared.ok) return { ok: false, file, message: prepared.error };
    const inserted = insertGsapTweenSource(prepared.text, {
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
    const { analyzeGsapSource, rewriteGsapMotionPathSource } = await loadGsapSource();
    const files = await this.loadCompositionSources(request.compositionKey);
    const candidates = [composition.meta?.module, ...(composition.meta?.deps ?? [])].filter((file): file is string => !!file);
    const file = candidates.find((candidate) => files[candidate]
      && analyzeGsapSource(files[candidate], { fps: composition.fps, file: candidate }).operations.some((entry) => entry.id === request.animationId));
    if (!file) return { ok: false, message: `Animation "${request.animationId}" no longer exists in source.` };
    const revision = await this.project.readSourceRevision(file);
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
    if (!composition || !file) return { ok: false, message: "This composition needs an authored source module for gesture paths." };
    if (!segments) return { ok: false, file, message: "Gesture fitting did not produce a valid cubic path." };
    const revision = await this.project.readSourceRevision(file);
    if (!revision?.text) return { ok: false, file, message: `Could not read ${file}.` };
    const id = `${request.objectId}-motion-path`.replace(/[^A-Za-z0-9_-]+/g, "-");
    const from = segments[0].from;
    const to = segments.at(-1)!.to;
    const { ensureGsapTimelineSource, insertGsapTweenSource, rewriteGsapMotionPathSource } = await loadGsapSource();
    const prepared = ensureGsapTimelineSource(revision.text, {
      fps: composition.fps,
      file,
      exportName: composition.meta?.exportName,
    });
    if (!prepared.ok) return { ok: false, file, message: prepared.error };
    const inserted = insertGsapTweenSource(prepared.text, {
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

  public async probeScriptSheet(compositionKey: string): Promise<ScriptSheetSnapshot | null> {
    const composition = this.registry[compositionKey];
    const file = composition?.meta?.sourceFormat !== "generated" ? composition.meta?.file : undefined;
    if (!composition || composition.meta?.kind !== "script" || !file) return null;
    const source = await this.project.readSource(file);
    return source == null ? null : parseScriptSheet(source);
  }

  private async refreshEditedComposition(compositionKey: string): Promise<void> {
    this.probed.delete(compositionKey);
    await this.probe(compositionKey);
    for (const preview of this.previews) {
      if (preview.compositionKey !== compositionKey) continue;
      preview.handle?.destroy();
      preview.handle = undefined;
      preview.mountedKey = undefined;
      this.renderPreview(preview);
    }
  }

  public async editPlan(request: PlanEditRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const file = composition?.meta?.sourceFormat !== "generated" ? composition.meta?.file : undefined;
    if (!composition || !file || (composition.meta?.kind !== "script" && composition.meta?.kind !== "plan")) {
      return { ok: false, message: "This composition is not a writable plan document." };
    }
    const revision = await this.project.readSourceRevision(file);
    if (!revision || revision.text == null) {
      return { ok: false, file, message: `Could not read ${file} through the project adapter.` };
    }
    const next = request.type === "retime"
      ? retimePlanRows(revision.text, { [request.rowId]: request.durationInFrames })
      : request.type === "move"
        ? movePlanRow(revision.text, request.rowId, request.beforeId)
        : request.type === "delete"
          ? deletePlanRow(revision.text, request.rowId)
          : request.type === "insert"
            ? insertPlanRow(revision.text, {
                beforeId: request.beforeId,
                durationInFrames: request.durationInFrames,
              })
            : setPlanRowSource(revision.text, request.rowId, request.source);
    if (next == null) return { ok: false, file, message: "The plan edit could not be applied to the authored row contract." };
    const label = request.type === "retime"
      ? "Retime script scene"
      : request.type === "move"
        ? "Reorder script scene"
        : request.type === "delete"
          ? "Delete script scene"
          : request.type === "insert"
            ? "Add script scene"
            : "Change script scene source";
    const committed = await this.commitSourceText(label, revision, next);
    if (!committed.ok) {
      return { ok: false, file, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
    }
    await this.refreshEditedComposition(request.compositionKey);
    return { ok: true, file, receipt: committed.receipt };
  }

  public async editPlacements(requests: PlacementEditRequest[]): Promise<PlacementEditResult> {
    if (!requests.length) return { ok: false, message: "No placement edits were requested." };
    const compositionKey = requests[0].compositionKey;
    if (requests.some((request) => request.compositionKey !== compositionKey)) {
      return { ok: false, message: "Atomic placement edits must target one composition." };
    }
    const composition = this.registry[compositionKey];
    if (composition?.meta?.timelineFile && composition.timeline) {
      return this.editTimelineDocumentPlacements(compositionKey, composition, requests);
    }
    const documentDurationEdits = composition ? requests.map((request) => {
      const binding = request.field === "durationInFrames" ? this.documentBinding(composition, request.itemId) : null;
      return binding && typeof binding.value.durationInFrames === "number"
        ? { file: binding.file, pointer: `${binding.pointer}/durationInFrames`, value: Math.max(1, Math.round(request.value)) }
        : null;
    }) : [];
    if (composition && documentDurationEdits.length > 0 && documentDurationEdits.every((edit) => edit != null)) {
      const files = [...new Set(documentDurationEdits.map((edit) => edit.file))];
      if (files.length !== 1) return { ok: false, message: "Document-backed placement edits must target one composition document." };
      return this.editJsonDocumentValues({
        compositionKey,
        file: files[0],
        edits: documentDurationEdits.map(({ pointer, value }) => ({ pointer, value })),
        label: requests.length === 1 ? "Edit composition duration" : "Edit composition durations",
      });
    }
    const file = composition?.meta?.file;
    if (!composition || !file) return { ok: false, message: "This composition does not declare a source file." };
    const revision = await this.project.readSourceRevision(file);
    const text = revision?.text;
    if (!revision || text == null) return { ok: false, file, message: `Could not read ${file} through the project adapter.` };

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
          ? Math.round(request.value * 1_000_000) / 1_000_000
          : Math.round(request.value);
      const rewritten = rewriteHtmlAttribute(nextText, request.itemId, attribute, value);
      if (rewritten == null) return { ok: false, file, message: `Clip "${request.itemId}" needs a stable data-fd-id before it can be edited.` };
      nextText = rewritten;
    }
    const layerRequests = requests.filter((entry) => entry.field === "layer");
    if (layerRequests.length) {
      const snapshot = timelineFromHtml({ ...composition, html: nextText });
      const nestedOutputKind = (reference: string) => {
        const key = resolveCompositionKey(this.registry, reference);
        return key ? this.registry[key]?.meta?.output : undefined;
      };
      const laneByItem = new Map(buildTimelineLanes(snapshot, nestedOutputKind)
        .flatMap((lane) => lane.items.map((item) => [item.id, lane.layer ?? 0] as const)));
      const requestedLayer = new Map(layerRequests.map((request) => [request.itemId, Math.round(request.value)]));
      const category = (item: TimelineItemSnapshot) =>
        item.content.type === "audio"
        || (item.content.type === "nested" && nestedOutputKind(item.content.compId) === "audio")
          ? "audio"
          : item.content.type === "grade-layer"
            ? "grade"
            : "video";
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

  private async editTimelineDocumentPlacements(
    compositionKey: string,
    composition: StudioComposition,
    requests: PlacementEditRequest[],
  ): Promise<PlacementEditResult> {
    const file = composition.meta?.timelineFile;
    if (!file || !composition.timeline) return { ok: false, message: "This composition has no external timeline document." };
    const revision = await this.project.readSourceRevision(file);
    if (!revision || revision.text == null) return { ok: false, file, message: `Could not read ${file} through the project adapter.` };
    let document: NonNullable<StudioComposition["timeline"]>;
    try {
      document = parsedTimelineDocument(revision.text);
    } catch (error) {
      return { ok: false, file, message: `${file} is not a valid FrameDiff timeline document: ${error instanceof Error ? error.message : String(error)}` };
    }
    const placementById = new Map(document.items.map((item) => [item.id, item]));
    const projectedById = new Map((this.probed.get(compositionKey) ?? timelineFromComposition(composition)).map((item) => [item.id, item]));
    for (const request of requests.filter((entry) => entry.field !== "layer")) {
      const placement = placementById.get(request.itemId);
      if (!placement) return { ok: false, file, message: `Timeline document ${file} has no placement named "${request.itemId}".` };
      if (request.field === "from") placement.from = Math.round(request.value);
      else if (request.field === "durationInFrames") placement.durationInFrames = Math.max(1, Math.round(request.value));
      else placement.trimStart = Math.round(request.value * 1_000_000) / 1_000_000;
    }
    const touchedKinds = new Set<TimelineLaneSnapshot["kind"]>();
    for (const request of requests.filter((entry) => entry.field === "layer")) {
      const placement = placementById.get(request.itemId);
      if (!placement) return { ok: false, file, message: `Timeline document ${file} has no placement named "${request.itemId}".` };
      const fallback = projectedById.get(placement.id);
      const kind = timelinePlacementKind(placement, fallback, this.registry);
      const previousLayer = placement.layer ?? fallback?.layer ?? 0;
      const targetLayer = Math.max(0, Math.round(request.value));
      // Dropping onto an occupied visual layer swaps only clips that are active at the same time.
      // Sequential clips may intentionally share a track, while simultaneous clips always retain
      // one unambiguous stacking rank.
      for (const other of document.items) {
        if (other === placement || timelinePlacementKind(other, projectedById.get(other.id), this.registry) !== kind) continue;
        if ((other.layer ?? projectedById.get(other.id)?.layer ?? 0) === targetLayer && placementsOverlap(placement, other)) {
          other.layer = previousLayer;
        }
      }
      placement.layer = targetLayer;
      touchedKinds.add(kind);
    }
    for (const kind of touchedKinds) {
      const placements = document.items.filter((placement) =>
        timelinePlacementKind(placement, projectedById.get(placement.id), this.registry) === kind);
      const ranks = [...new Set(placements.map((placement) => placement.layer ?? projectedById.get(placement.id)?.layer ?? 0))].sort((a, b) => a - b);
      const normalized = new Map(ranks.map((rank, index) => [rank, index]));
      for (const placement of placements) {
        const rank = placement.layer ?? projectedById.get(placement.id)?.layer ?? 0;
        placement.layer = normalized.get(rank) ?? 0;
      }
    }
    try {
      defineTimelineDocument(document);
    } catch (error) {
      return { ok: false, file, message: `The placement edit would make ${file} invalid: ${error instanceof Error ? error.message : String(error)}` };
    }
    const committed = await this.commitSourceText(
      requests.length === 1 ? "Edit timeline document placement" : "Edit timeline document placements",
      revision,
      `${JSON.stringify(document, null, 2)}\n`,
    );
    if (!committed.ok) return { ok: false, file, message: committed.message, conflicts: committed.conflicts };

    // Apply the data edit immediately. A later JSON HMR update is harmless, but Studio does not
    // wait for it and does not remount unrelated compositions.
    composition.timeline = document;
    await this.refreshEditedComposition(compositionKey);
    return { ok: true, file, receipt: committed.receipt };
  }

  public async deleteTimelineItems(request: TimelineDeleteRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const itemIds = [...new Set(request.itemIds)];
    if (!composition || (composition.meta?.kind ?? "edit") !== "edit") return { ok: false, message: "Only edit compositions expose removable timeline layers." };
    if (!itemIds.length) return { ok: false, message: "No timeline items were selected for deletion." };

    const snapshot = await this.probe(request.compositionKey);
    const byId = new Map(snapshot.map((item) => [item.id, item]));
    const unknown = itemIds.filter((id) => !byId.get(id)?.editable?.delete);
    if (unknown.length) return { ok: false, message: `Timeline item${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")} cannot be removed safely.` };

    const changes: Array<{ before: { file: string; text: string | null; hash: string | null }; text: string | null }> = [];
    let nextTimeline: CompositionTimelineDocument | undefined;
    const timelineFile = composition.meta?.timelineFile;
    if (timelineFile && composition.timeline) {
      const revision = await this.project.readSourceRevision(timelineFile);
      if (!revision || revision.text == null) return { ok: false, file: timelineFile, message: `Could not read ${timelineFile}.` };
      try {
        const parsed = parsedTimelineDocument(revision.text);
        nextTimeline = { ...parsed, items: parsed.items.filter((item) => !itemIds.includes(item.id)) };
      } catch (error) {
        return { ok: false, file: timelineFile, message: `${timelineFile} is not a valid FrameDiff timeline document: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (request.compactLayer) {
        for (const placement of nextTimeline.items) {
          const item = byId.get(placement.id);
          const kind = item?.content.type === "audio" ? "audio" : item?.content.type === "grade-layer" ? "grade" : "video";
          if (kind === request.compactLayer.kind && placement.layer != null && placement.layer > request.compactLayer.layer) {
            placement.layer -= 1;
          }
        }
      }
      changes.push({ before: revision, text: `${JSON.stringify(nextTimeline, null, 2)}\n` });
    }

    const htmlFile = composition.meta?.sourceFormat !== "generated" ? composition.meta?.file : undefined;
    let nextHtml = composition.html;
    if (htmlFile) {
      const revision = await this.project.readSourceRevision(htmlFile);
      if (!revision || revision.text == null) return { ok: false, file: htmlFile, message: `Could not read ${htmlFile}.` };
      const remainingSourceItems = snapshot
        .filter((item) => !itemIds.includes(item.id) && findHtmlElementById(revision.text!, item.id))
        .map((item) => item.id);
      nextHtml = revision.text;
      for (const itemId of itemIds) nextHtml = removeHtmlElement(nextHtml, itemId) ?? nextHtml;
      const removedAlongsideSelection = remainingSourceItems.filter((itemId) => !findHtmlElementById(nextHtml, itemId));
      if (removedAlongsideSelection.length) {
        return {
          ok: false,
          file: htmlFile,
          message: `Deleting ${itemIds.join(", ")} would also remove timeline item${removedAlongsideSelection.length === 1 ? "" : "s"} ${removedAlongsideSelection.join(", ")} from the composition source.`,
        };
      }
      if (request.compactLayer) {
        for (const item of snapshot) {
          const kind = item.content.type === "audio" ? "audio" : item.content.type === "grade-layer" ? "grade" : "video";
          if (!itemIds.includes(item.id) && kind === request.compactLayer.kind && item.layer != null && item.layer > request.compactLayer.layer) {
            nextHtml = rewriteHtmlAttribute(nextHtml, item.id, "data-fd-layer", item.layer - 1) ?? nextHtml;
          }
        }
      }
      if (nextHtml !== revision.text) changes.push({ before: revision, text: nextHtml });
    }
    if (!changes.length) return { ok: false, message: "The selected timeline items have no writable source authority." };

    const label = request.compactLayer
      ? `Delete ${request.compactLayer.kind} layer ${request.compactLayer.layer + 1}`
      : itemIds.length === 1 ? `Delete timeline item ${itemIds[0]}` : "Delete timeline items";
    const committed = await this.commitSourceTexts(label, changes);
    if (!committed.ok) return { ok: false, message: committed.message, conflicts: committed.conflicts };
    if (nextTimeline) composition.timeline = nextTimeline;
    if (nextHtml !== composition.html) composition.html = nextHtml;
    await this.refreshEditedComposition(request.compositionKey);
    return { ok: true, file: timelineFile ?? htmlFile, receipt: committed.receipt };
  }

  public async createTimelineShape(request: TimelineShapeCreateRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const file = composition?.meta?.timelineFile;
    if (!composition || !file || !composition.timeline) {
      return { ok: false, message: "Shapes require an edit composition with an external timeline document." };
    }
    const revision = await this.project.readSourceRevision(file);
    if (!revision || revision.text == null) return { ok: false, file, message: `Could not read ${file}.` };
    let document: CompositionTimelineDocument;
    try {
      document = parsedTimelineDocument(revision.text);
    } catch (error) {
      return { ok: false, file, message: `${file} is not a valid FrameDiff timeline document: ${error instanceof Error ? error.message : String(error)}` };
    }
    const stem = request.shape === "rect" ? "rectangle" : request.shape;
    const ids = new Set(document.items.map((item) => item.id));
    let id = `${stem}-shape`;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${stem}-shape-${suffix}`;
    const projectedById = new Map(timelineFromComposition(composition).map((item) => [item.id, item]));
    const visualLayers = document.items
      .filter((placement) => timelinePlacementKind(placement, projectedById.get(placement.id), this.registry) === "video")
      .map((placement) => placement.layer ?? projectedById.get(placement.id)?.layer ?? 0);
    const layer = visualLayers.length ? Math.max(...visualLayers) + 1 : 0;
    const width = request.shape === "line" ? composition.width * 0.5 : composition.width * 0.42;
    const height = request.shape === "line" ? Math.max(24, composition.height * 0.06) : composition.height * 0.38;
    const x = (composition.width - width) / 2;
    const y = (composition.height - height) / 2;
    const from = Math.round(request.from);
    document.version = 2;
    document.items.push({
      id,
      name: `${stem[0].toUpperCase()}${stem.slice(1)} shape`,
      from,
      durationInFrames: Math.max(1, composition.durationInFrames - from),
      layer,
      layout: {
        rect: [Math.round(x), Math.round(y), Math.round(width), Math.round(height)],
        fit: "fill",
        cornerRadius: request.shape === "rect" ? 20 : 0,
        opacity: 1,
      },
      content: {
        type: "shape",
        shape: request.shape,
        fill: request.shape === "line" ? "none" : "#f0b969",
        stroke: "#f0b969",
        strokeWidth: request.shape === "line" ? 6 : 2,
        ...(request.shape === "path" ? { d: "M 8 50 C 22 8 78 8 92 50 C 78 92 22 92 8 50 Z" } : {}),
      },
    });
    try {
      defineTimelineDocument(document);
    } catch (error) {
      return { ok: false, file, message: `Could not create the shape: ${error instanceof Error ? error.message : String(error)}` };
    }
    const committed = await this.commitSourceText(`Add ${stem} shape`, revision, `${JSON.stringify(document, null, 2)}\n`);
    if (!committed.ok) return { ok: false, file, message: committed.message, conflicts: committed.conflicts };
    composition.timeline = document;
    await this.refreshEditedComposition(request.compositionKey);
    return { ok: true, file, receipt: committed.receipt };
  }

  public async inspectItem(compositionKey: string, itemId: string): Promise<InspectorDetailsSnapshot> {
    const composition = this.registry[compositionKey];
    if (!composition) return { compositionKey, itemId, sections: [] };
    const item = (this.probed.get(compositionKey) ?? await this.probe(compositionKey)).find((entry) => entry.id === itemId);
    const files = await this.loadCompositionSources(compositionKey);
    const file = composition.meta?.file;
    const sections: InspectorSectionSnapshot[] = [];
    const locationKey = (fieldId: string) => `${compositionKey}:${itemId}:${fieldId}`;
    const remember = (fieldId: string, resolved: ResolvedExpr | StringLiteralLoc | undefined) => {
      if (resolved?.kind === "literal") this.inspectorLocations.set(locationKey(fieldId), resolved);
      if (resolved?.kind === "string-literal") this.inspectorLocations.set(locationKey(fieldId), resolved);
    };

    const documentMetadata = composition.meta?.document;
    const documentPointer = documentMetadata?.bindings?.[itemId]
      ?? (itemId === composition.id ? "" : undefined);
    if (documentMetadata && documentPointer != null && files[documentMetadata.file]) {
      try {
        const document = JSON.parse(files[documentMetadata.file]);
        const schemaText = documentMetadata.schema ? await this.project.readSource(documentMetadata.schema) : null;
        const schema = schemaText ? JSON.parse(schemaText) : undefined;
        let fields = inspectorFieldsFromJsonDocument(documentMetadata.file, document, schema, documentPointer);
        // The composition-level Inspector owns document settings that are not already owned by
        // a clickable element. This keeps scene-wide motion/simulation controls immediately
        // available without duplicating every element's properties in the default panel.
        if (documentPointer === "") {
          const elementPointers = Object.entries(documentMetadata.bindings ?? {})
            .filter(([boundItemId, pointer]) => boundItemId !== composition.id && pointer !== "")
            .map(([, pointer]) => pointer);
          fields = fields.filter((field) => {
            if (!field.id.startsWith("json:")) return true;
            const pointer = decodeURIComponent(field.id.slice(field.id.lastIndexOf(":") + 1));
            return !elementPointers.some((elementPointer) => pointer === elementPointer || pointer.startsWith(`${elementPointer}/`));
          });
        }
        if (fields.length) sections.push({
          id: `document:${documentPointer || "root"}`,
          title: documentMetadata.inspector?.title ?? (documentPointer === "" ? "COMPOSITION PROPERTIES" : "DOCUMENT PROPERTIES"),
          kind: documentMetadata.inspector?.kind ?? "data",
          fields,
          ...(documentMetadata.inspector?.editor ? {
            editor: {
              presentation: "inline-modal" as const,
              label: documentMetadata.inspector.editor.label,
              description: documentMetadata.inspector.editor.description,
            },
          } : {}),
        });
      } catch (error) {
        sections.push({
          id: "document:error",
          title: "DOCUMENT PROPERTIES",
          kind: "data",
          fields: [{ id: "document:error", label: error instanceof Error ? error.message : String(error), editable: false, valueType: "text" }],
        });
      }
    }

    const timelinePlacement = composition.meta?.timelineFile
      ? composition.timeline?.items.find((placement) => placement.id === itemId)
      : undefined;
    const previewNode = [...this.previews]
      .filter((preview) => preview.compositionKey === compositionKey)
      .flatMap((preview) => previewNodes(preview))
      .find((node) => node.ref.objectId === itemId);
    const timelineType = timelinePlacement?.content?.type ?? item?.content.type;
    if (timelinePlacement && timelineType !== "audio") {
      const rect = timelinePlacement.layout?.rect
        ?? (previewNode
          ? [previewNode.bounds.x, previewNode.bounds.y, previewNode.bounds.width, previewNode.bounds.height] as const
          : [0, 0, composition.width, composition.height] as const);
      const source = composition.meta?.timelineFile;
      const numberField = (
        id: string,
        label: string,
        value: number,
        options: { min?: number; max?: number; step?: number; slider?: boolean } = {},
      ): InspectorFieldSnapshot => ({
        id,
        label,
        value,
        valueType: "number",
        editable: true,
        step: options.step ?? 1,
        source,
        control: { type: "number", value, ...options },
      });
      const layoutFields: InspectorFieldSnapshot[] = [
        numberField("timeline:layout:x", "x", rect[0]),
        numberField("timeline:layout:y", "y", rect[1]),
        numberField("timeline:layout:width", "width", rect[2], { min: 1 }),
        numberField("timeline:layout:height", "height", rect[3], { min: 1 }),
      ];
      if (timelineType === "nested" || timelineType === "video" || timelineType === "image") {
        const fit = timelinePlacement.layout?.fit ?? "cover";
        layoutFields.push({
          id: "timeline:layout:fit",
          label: "fit",
          text: fit,
          valueType: "text",
          editable: true,
          source,
          control: {
            type: "select",
            value: fit,
            options: [
              { value: "cover", label: "cover / crop" },
              { value: "contain", label: "contain / letterbox" },
              { value: "fill", label: "stretch" },
            ],
          },
        });
        layoutFields.push(
          numberField("timeline:layout:focal-x", "focal x", timelinePlacement.layout?.focalPoint?.[0] ?? 0.5, { min: 0, max: 1, step: 0.01, slider: true }),
          numberField("timeline:layout:focal-y", "focal y", timelinePlacement.layout?.focalPoint?.[1] ?? 0.5, { min: 0, max: 1, step: 0.01, slider: true }),
        );
      }
      layoutFields.push(
        numberField("timeline:layout:corner-radius", "corner radius", timelinePlacement.layout?.cornerRadius ?? 0, { min: 0 }),
        numberField("timeline:layout:opacity", "opacity", timelinePlacement.layout?.opacity ?? 1, { min: 0, max: 1, step: 0.01, slider: true }),
      );
      sections.push({ id: "timeline-layout", title: "LAYOUT", kind: "data", fields: layoutFields });
    }
    if (timelinePlacement?.content?.type === "shape") {
      const content = timelinePlacement.content;
      const fields: InspectorFieldSnapshot[] = [
        {
          id: "timeline:shape:kind",
          label: "shape",
          text: content.shape,
          valueType: "text",
          editable: true,
          source: composition.meta?.timelineFile,
          control: {
            type: "select",
            value: content.shape,
            options: ["rect", "ellipse", "line", "polygon", "path"].map((value) => ({ value, label: value })),
          },
        },
        {
          id: "timeline:shape:fill",
          label: "fill",
          text: content.fill ?? "#f0b969",
          valueType: "text",
          editable: true,
          source: composition.meta?.timelineFile,
          control: { type: "color", value: content.fill === "none" ? "#000000" : content.fill ?? "#f0b969" },
        },
        {
          id: "timeline:shape:stroke",
          label: "stroke",
          text: content.stroke ?? "#f0b969",
          valueType: "text",
          editable: true,
          source: composition.meta?.timelineFile,
          control: { type: "color", value: content.stroke === "none" ? "#000000" : content.stroke ?? "#f0b969" },
        },
        {
          id: "timeline:shape:stroke-width",
          label: "stroke width",
          value: content.strokeWidth ?? 0,
          valueType: "number",
          editable: true,
          step: 0.5,
          source: composition.meta?.timelineFile,
          control: { type: "number", value: content.strokeWidth ?? 0, min: 0, step: 0.5 },
        },
      ];
      if (content.shape === "polygon") fields.push({
        id: "timeline:shape:points",
        label: "points",
        text: content.points ?? "50,2 98,50 50,98 2,50",
        valueType: "text",
        editable: true,
        source: composition.meta?.timelineFile,
        control: { type: "text", value: content.points ?? "50,2 98,50 50,98 2,50" },
      });
      if (content.shape === "path") fields.push({
        id: "timeline:shape:path",
        label: "SVG path",
        text: content.d ?? "",
        valueType: "text",
        editable: true,
        source: composition.meta?.timelineFile,
        control: { type: "text", value: content.d ?? "", multiline: true },
      });
      sections.push({ id: "timeline-shape", title: "SHAPE", kind: "data", fields });
    }
    if (timelinePlacement?.content?.type === "image") {
      sections.push({
        id: "timeline-content",
        title: "MEDIA",
        kind: "data",
        fields: [{
          id: "timeline:src",
          label: "source",
          text: timelinePlacement.content.src,
          valueType: "text",
          editable: true,
          source: composition.meta?.timelineFile,
          control: { type: "text", value: timelinePlacement.content.src },
        }],
      });
    }
    const timelineAudioContent = item?.content.type === "nested" || item?.content.type === "video" || item?.content.type === "audio"
      ? item.content
      : undefined;
    const timelineOwnsPlacementAudio = !!timelinePlacement && !!timelineAudioContent;
    if (timelinePlacement && timelineAudioContent) {
      const fields: InspectorFieldSnapshot[] = timelineAudioContent.type === "nested"
        ? [
            {
              id: "timeline:composition",
              label: "composition",
              text: timelinePlacement.content?.type === "nested"
                ? timelinePlacement.content.composition
                : timelineAudioContent.compId,
              valueType: "text",
              editable: true,
              source: composition.meta?.timelineFile,
              control: {
                type: "text",
                value: timelinePlacement.content?.type === "nested"
                  ? timelinePlacement.content.composition
                  : timelineAudioContent.compId,
              },
            },
            {
              id: "timeline:nested-scale",
              label: "nested scale",
              value: timelinePlacement.content?.type === "nested"
                ? timelinePlacement.content.nestedScale ?? timelineAudioContent.nestedScale ?? 1
                : timelineAudioContent.nestedScale ?? 1,
              valueType: "number",
              editable: true,
              step: 0.01,
              source: composition.meta?.timelineFile,
              control: {
                type: "number",
                value: timelinePlacement.content?.type === "nested"
                  ? timelinePlacement.content.nestedScale ?? timelineAudioContent.nestedScale ?? 1
                  : timelineAudioContent.nestedScale ?? 1,
                min: 0.01,
                step: 0.01,
              },
            },
          ]
        : [{
            id: "timeline:src",
            label: "source",
            text: timelinePlacement.content?.type === "video" || timelinePlacement.content?.type === "audio"
              ? timelinePlacement.content.src
              : timelineAudioContent.src,
            valueType: "text",
            editable: true,
            source: composition.meta?.timelineFile,
            control: {
              type: "text",
              value: timelinePlacement.content?.type === "video" || timelinePlacement.content?.type === "audio"
                ? timelinePlacement.content.src
                : timelineAudioContent.src,
            },
          }];
      fields.push(
        {
          id: "timeline:trim-start",
          label: "trim start",
          value: timelinePlacement.trimStart ?? timelineAudioContent.trimStart ?? 0,
          valueType: "number",
          editable: true,
          step: 0.01,
          source: composition.meta?.timelineFile,
          control: { type: "number", value: timelinePlacement.trimStart ?? timelineAudioContent.trimStart ?? 0, step: 0.01, unit: "s" },
        },
        {
          id: "timeline:playback-rate",
          label: "playback rate",
          value: timelinePlacement.playbackRate ?? timelineAudioContent.playbackRate ?? 1,
          valueType: "number",
          editable: true,
          step: 0.01,
          source: composition.meta?.timelineFile,
          control: { type: "number", value: timelinePlacement.playbackRate ?? timelineAudioContent.playbackRate ?? 1, min: 0.01, step: 0.01 },
        },
      );
      sections.push({
        id: "timeline-content",
        title: timelineAudioContent.type === "nested" ? "NESTED COMPOSITION" : "MEDIA",
        kind: "data",
        fields,
      });
    }
    if (timelineOwnsPlacementAudio) {
      const volume = Math.max(0, Math.min(1, timelinePlacement.volume ?? timelineAudioContent.volume ?? 1));
      const muted = timelinePlacement.muted ?? timelineAudioContent.muted ?? false;
      sections.push({
        id: "timeline-media-audio",
        title: item?.content.type === "nested" ? "COMPOSITION AUDIO" : item?.content.type === "video" ? "VIDEO AUDIO" : "AUDIO",
        kind: "data",
        fields: [
          {
            id: "timeline:volume",
            label: "volume",
            value: volume,
            valueType: "number",
            editable: true,
            step: 0.01,
            source: composition.meta?.timelineFile,
            control: { type: "number", value: volume, min: 0, max: 1, step: 0.01, slider: true },
          },
          {
            id: "timeline:muted",
            label: "muted",
            boolean: muted,
            valueType: "boolean",
            editable: true,
            source: composition.meta?.timelineFile,
            control: { type: "boolean", value: muted },
          },
        ],
      });
    }

    // Generated HTML often contains template expressions rather than rewriteable authored
    // attribute literals. Its explicit editableData declarations remain available below.
    if (file && files[file] && composition.meta?.sourceFormat !== "generated") {
      const timelineOwnedAttributes = new Set([
        "data-fd-from",
        "data-fd-duration",
        "data-fd-layer",
        "data-fd-trim-start",
        "data-fd-playback-rate",
        "data-fd-volume",
        "data-fd-muted",
        "data-fd-x",
        "data-fd-y",
        "data-fd-width",
        "data-fd-height",
        "data-fd-fit",
        "data-fd-image-position",
        "data-fd-border-radius",
        "data-fd-opacity",
        "data-fd-z-index",
      ]);
      const fields = inspectorFieldsFromHtml(files[file], itemId).filter((field) => {
        const placement = composition.timeline?.items.find((candidate) => candidate.id === field.targetId);
        if (!placement) return true;
        if (timelineOwnedAttributes.has(field.attribute)) return false;
        if (placement.content?.type === "nested") {
          return field.attribute !== "data-fd-comp" && field.attribute !== "data-fd-nested-scale";
        }
        if (placement.content?.type === "video" || placement.content?.type === "audio") {
          return field.attribute !== "data-fd-src";
        }
        if (placement.content?.type === "image") return field.attribute !== "data-fd-image" && field.attribute !== "data-fd-src";
        return true;
      });
      const grade = fields.filter((field) => htmlGradeAttributes.includes(field.attribute) || ["data-fd-lut", "data-fd-lut-name", "data-fd-lut-intensity"].includes(field.attribute));
      const properties = fields.filter((field) => !grade.includes(field));
      if (properties.length) sections.push({
        id: "properties",
        title: itemId === composition.id ? "COMPOSITION FORMAT" : "PROPERTIES",
        kind: "data",
        fields: properties,
      });
      if (grade.length) {
        sections.push({
          id: "grade",
          title: "COLOR GRADE",
          kind: "grade",
          fields: grade,
          presets: Object.entries(GRADE_PRESETS).map(([id, preset]) => ({ id, label: preset.label })),
          editor: {
            presentation: "inline-modal",
            label: "Open color workspace",
            description: "A larger effect workspace using the same source-backed controls and presets.",
          },
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
    if (request.fieldId.startsWith("timeline:")) return this.editTimelinePlacementProperty(request);
    if (request.fieldId.startsWith("json:")) return this.editJsonDocumentField(request);
    if (request.fieldId.startsWith("html:") || request.fieldId.startsWith("html-target:")) {
      const composition = this.registry[request.compositionKey];
      const binding = composition && this.documentBinding(composition, request.itemId);
      if (request.fieldId === "html:data-fd-text" && binding && typeof binding.value.text === "string") {
        return this.editJsonDocumentValues({
          compositionKey: request.compositionKey,
          file: binding.file,
          edits: [{ pointer: appendJsonPointer(binding.pointer, "text"), value: request.value }],
          label: "Edit composition document text",
        });
      }
      const file = composition?.meta?.file;
      if (!file) return { ok: false, message: "This composition does not declare its HTML source file." };
      const revision = await this.project.readSourceRevision(file);
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

  private async editTimelinePlacementProperty(request: InspectorFieldEditRequest): Promise<PlacementEditResult> {
    const composition = this.registry[request.compositionKey];
    const file = composition?.meta?.timelineFile;
    if (!composition || !file || !composition.timeline) return { ok: false, message: "This item has no external timeline document." };
    const revision = await this.project.readSourceRevision(file);
    if (!revision || revision.text == null) return { ok: false, file, message: `Could not read ${file}.` };
    let document: CompositionTimelineDocument;
    try {
      document = parsedTimelineDocument(revision.text);
    } catch (error) {
      return { ok: false, file, message: `${file} is not a valid FrameDiff timeline document: ${error instanceof Error ? error.message : String(error)}` };
    }
    const placement = document.items.find((item) => item.id === request.itemId);
    const type = placement?.content?.type
      ?? this.probed.get(request.compositionKey)?.find((item) => item.id === request.itemId)?.content.type;
    if (!placement) return { ok: false, file, message: `"${request.itemId}" does not have editable timeline content.` };
    const previewNode = [...this.previews]
      .filter((preview) => preview.compositionKey === request.compositionKey)
      .flatMap((preview) => previewNodes(preview))
      .find((node) => node.ref.objectId === request.itemId);
    const ensureLayout = () => {
      document.version = 2;
      placement.layout ??= {
        rect: previewNode
          ? [previewNode.bounds.x, previewNode.bounds.y, previewNode.bounds.width, previewNode.bounds.height]
          : [0, 0, composition.width, composition.height],
        fit: type === "shape" ? "fill" : "cover",
        cornerRadius: 0,
        opacity: 1,
      };
      return placement.layout;
    };
    let label: string;
    if (request.fieldId.startsWith("timeline:layout:")) {
      const layout = ensureLayout();
      const property = request.fieldId.slice("timeline:layout:".length);
      if (property === "fit") {
        if (typeof request.value !== "string" || !["cover", "contain", "fill"].includes(request.value)) {
          return { ok: false, file, message: "Fit must be cover, contain, or fill." };
        }
        layout.fit = request.value as "cover" | "contain" | "fill";
      } else {
        if (typeof request.value !== "number" || !Number.isFinite(request.value)) return { ok: false, file, message: `${property} must be a number.` };
        if (property === "x") layout.rect[0] = request.value;
        else if (property === "y") layout.rect[1] = request.value;
        else if (property === "width") layout.rect[2] = Math.max(1, request.value);
        else if (property === "height") layout.rect[3] = Math.max(1, request.value);
        else if (property === "focal-x") layout.focalPoint = [Math.max(0, Math.min(1, request.value)), layout.focalPoint?.[1] ?? 0.5];
        else if (property === "focal-y") layout.focalPoint = [layout.focalPoint?.[0] ?? 0.5, Math.max(0, Math.min(1, request.value))];
        else if (property === "corner-radius") layout.cornerRadius = Math.max(0, request.value);
        else if (property === "opacity") layout.opacity = Math.max(0, Math.min(1, request.value));
        else return { ok: false, file, message: `Unknown timeline layout property: ${property}` };
      }
      label = "Edit timeline layout";
    } else if (request.fieldId.startsWith("timeline:shape:")) {
      if (placement.content?.type !== "shape") return { ok: false, file, message: `"${request.itemId}" is not a shape.` };
      const property = request.fieldId.slice("timeline:shape:".length);
      if (property === "kind") {
        if (typeof request.value !== "string" || !["rect", "ellipse", "line", "polygon", "path"].includes(request.value)) {
          return { ok: false, file, message: "Choose rect, ellipse, line, polygon, or path." };
        }
        placement.content.shape = request.value as "rect" | "ellipse" | "line" | "polygon" | "path";
      } else if (property === "stroke-width") {
        if (typeof request.value !== "number" || !Number.isFinite(request.value)) return { ok: false, file, message: "Stroke width must be a number." };
        placement.content.strokeWidth = Math.max(0, request.value);
      } else if (property === "fill" || property === "stroke") {
        if (typeof request.value !== "string" || !request.value.trim()) return { ok: false, file, message: `${property} must be a CSS color.` };
        placement.content[property] = request.value.trim();
      } else if (property === "points") {
        if (typeof request.value !== "string") return { ok: false, file, message: "Polygon points must be text." };
        placement.content.points = request.value;
      } else if (property === "path") {
        if (typeof request.value !== "string") return { ok: false, file, message: "SVG path data must be text." };
        placement.content.d = request.value;
      } else return { ok: false, file, message: `Unknown shape property: ${property}` };
      document.version = 2;
      label = "Edit timeline shape";
    } else if (request.fieldId === "timeline:volume") {
      if (typeof request.value !== "number" || !Number.isFinite(request.value)) return { ok: false, file, message: "Volume must be a number." };
      placement.volume = Math.max(0, Math.min(1, request.value));
      label = "Adjust placement volume";
    } else if (request.fieldId === "timeline:muted") {
      if (typeof request.value !== "boolean") return { ok: false, file, message: "Muted must be true or false." };
      placement.muted = request.value;
      label = request.value ? "Mute placement" : "Unmute placement";
    } else if (request.fieldId === "timeline:trim-start") {
      if (typeof request.value !== "number" || !Number.isFinite(request.value)) return { ok: false, file, message: "Trim start must be a number." };
      placement.trimStart = request.value;
      label = "Adjust placement trim";
    } else if (request.fieldId === "timeline:playback-rate") {
      if (typeof request.value !== "number" || !Number.isFinite(request.value) || request.value <= 0) {
        return { ok: false, file, message: "Playback rate must be greater than zero." };
      }
      placement.playbackRate = request.value;
      label = "Adjust placement playback rate";
    } else if (request.fieldId === "timeline:composition") {
      if (placement.content?.type !== "nested" || typeof request.value !== "string" || !request.value.trim()) {
        return { ok: false, file, message: "Composition must be a non-empty registry key." };
      }
      placement.content = { ...placement.content, composition: request.value.trim() };
      label = "Change nested composition";
    } else if (request.fieldId === "timeline:nested-scale") {
      if (placement.content?.type !== "nested" || typeof request.value !== "number" || !Number.isFinite(request.value) || request.value <= 0) {
        return { ok: false, file, message: "Nested scale must be greater than zero." };
      }
      placement.content = { ...placement.content, nestedScale: request.value };
      label = "Adjust nested composition scale";
    } else if (request.fieldId === "timeline:src") {
      if ((placement.content?.type !== "video" && placement.content?.type !== "image" && placement.content?.type !== "audio")
        || typeof request.value !== "string" || !request.value.trim()) {
        return { ok: false, file, message: "Media source must be a non-empty asset or URL." };
      }
      placement.content = { ...placement.content, src: request.value.trim() };
      label = "Change media source";
    } else {
      return { ok: false, file, message: `Unknown timeline property: ${request.fieldId}` };
    }
    try {
      defineTimelineDocument(document);
    } catch (error) {
      return { ok: false, file, message: `The Inspector edit would make ${file} invalid: ${error instanceof Error ? error.message : String(error)}` };
    }
    const committed = await this.commitSourceText(
      label,
      revision,
      `${JSON.stringify(document, null, 2)}\n`,
    );
    if (!committed.ok) return { ok: false, file, message: committed.message, conflicts: committed.conflicts };
    composition.timeline = document;
    await this.refreshEditedComposition(request.compositionKey);
    return { ok: true, file, receipt: committed.receipt };
  }

  private async editJsonDocumentField(request: InspectorFieldEditRequest): Promise<PlacementEditResult> {
    const match = /^json:([^:]+):(.+)$/.exec(request.fieldId);
    if (!match) return { ok: false, message: `Invalid JSON document field: ${request.fieldId}` };
    const file = decodeURIComponent(match[1]);
    const pointer = decodeURIComponent(match[2]);
    const composition = this.registry[request.compositionKey];
    if (!composition || composition.meta?.document?.file !== file) return { ok: false, file, message: `${file} is not the selected composition document.` };
    return this.editJsonDocumentValues({
      compositionKey: request.compositionKey,
      file,
      edits: [{ pointer, value: request.value }],
      label: "Edit composition document property",
    });
  }

  private documentBinding(composition: StudioComposition, objectId: string): { file: string; pointer: string; value: Record<string, unknown> } | null {
    const metadata = composition.meta?.document;
    const pointer = metadata?.bindings?.[objectId];
    const value = pointer == null ? undefined : jsonPointerValue(composition.document, pointer);
    return metadata && pointer != null && value != null && typeof value === "object" && !Array.isArray(value)
      ? { file: metadata.file, pointer, value: value as Record<string, unknown> }
      : null;
  }

  private async editJsonDocumentValues(options: {
    compositionKey: string;
    file: string;
    edits: Array<{ pointer: string; value: number | string | boolean }>;
    label: string;
    groupId?: string;
  }): Promise<PlacementEditResult> {
    const composition = this.registry[options.compositionKey];
    if (!composition || composition.meta?.document?.file !== options.file) {
      return { ok: false, file: options.file, message: `${options.file} is not the selected composition document.` };
    }
    const revision = await this.project.readSourceRevision(options.file);
    if (!revision || revision.text == null) return { ok: false, file: options.file, message: `Could not read ${options.file}.` };
    let document: unknown;
    try { document = JSON.parse(revision.text); }
    catch (error) { return { ok: false, file: options.file, message: `${options.file} is invalid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
    for (const edit of options.edits) {
      if (!setJsonPointerValue(document, edit.pointer, edit.value)) {
        return { ok: false, file: options.file, message: `Could not resolve ${edit.pointer} in ${options.file}.` };
      }
    }
    const committed = await this.commitSourceText(options.label, revision, `${JSON.stringify(document, null, 2)}\n`, options.groupId);
    if (!committed.ok) return { ok: false, file: options.file, message: committed.message, conflicts: committed.conflicts };

    // A remount document is consumed while constructing setup/GPU resources. Replace the local
    // registry entry immediately so the preview and Inspector move to the accepted source state
    // without waiting for Vite's watcher. The ensuing HMR registry contains the same document and
    // is therefore runtime-equal, avoiding a second remount.
    if (composition.meta?.document?.hotUpdate === "remount") {
      let nextComposition = { ...composition, document };
      if (composition.meta.sourceFormat === "generated") {
        const rawItems = timelineFromComposition(composition);
        const durationEdit = options.edits.flatMap((edit) => {
          if (!edit.pointer.endsWith("/durationInFrames") || typeof edit.value !== "number") return [];
          const binding = Object.entries(composition.meta?.document?.bindings ?? {})
            .find(([, pointer]) => `${pointer}/durationInFrames` === edit.pointer);
          const item = binding ? rawItems.find((candidate) => candidate.id === binding[0]) : undefined;
          return item && rawItems.length === 1 && item.from === 0 && item.durationInFrames === composition.durationInFrames
            ? [{ itemId: item.id, durationInFrames: Math.max(1, Math.round(edit.value)) }]
            : [];
        })[0];
        if (durationEdit) {
          let html = rewriteHtmlAttribute(composition.html, durationEdit.itemId, "data-fd-duration", durationEdit.durationInFrames)
            ?? composition.html;
          html = rewriteHtmlAttribute(html, composition.id, "data-fd-duration", durationEdit.durationInFrames) ?? html;
          nextComposition = { ...nextComposition, durationInFrames: durationEdit.durationInFrames, html };
        }
      }
      this.replaceRegistry({
        ...this.registry,
        [options.compositionKey]: nextComposition,
      });
      return { ok: true, file: options.file, receipt: committed.receipt };
    }
    composition.document = document;
    for (const preview of this.previews) {
      if (preview.compositionKey !== options.compositionKey) continue;
      preview.handle?.updateDocument(document);
    }
    return { ok: true, file: options.file, receipt: committed.receipt };
  }

  public async editInspectorFields(request: InspectorFieldsEditRequest): Promise<PlacementEditResult> {
    if (!request.edits.length) return { ok: false, message: "No Inspector fields changed." };
    const unique = [...new Map(request.edits.map((edit) => [edit.fieldId, edit])).values()];
    const jsonEdits = unique.map((edit) => {
      const match = /^json:([^:]+):(.+)$/.exec(edit.fieldId);
      return match ? { file: decodeURIComponent(match[1]), pointer: decodeURIComponent(match[2]), value: edit.value } : null;
    });
    if (jsonEdits.every((edit) => edit != null)) {
      const files = [...new Set(jsonEdits.map((edit) => edit.file))];
      if (files.length !== 1) return { ok: false, message: "JSON Inspector batches must target one composition document." };
      return this.editJsonDocumentValues({
        compositionKey: request.compositionKey,
        file: files[0],
        edits: jsonEdits.map(({ pointer, value }) => ({ pointer, value })),
        label: request.label ?? (unique.length === 1 ? "Edit composition document property" : "Edit composition document properties"),
        groupId: request.groupId,
      });
    }
    if (jsonEdits.some((edit) => edit != null)) {
      return { ok: false, message: "One Inspector gesture cannot mix JSON document fields with code-backed fields." };
    }
    await this.inspectItem(request.compositionKey, request.itemId);
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
    const revisions = await Promise.all(files.map((file) => this.project.readSourceRevision(file)));
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
    const committed = await this.project.applySourceEdit({
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
    if (!composition) return { ok: false, message: "This composition is unavailable." };
    const entries = Object.entries(request.patch);
    if (!entries.length) return { ok: false, file, message: "No element properties changed." };
    if (entries.some(([, value]) => !Number.isFinite(value))) return { ok: false, file, message: "Element geometry must use finite numbers." };
    if ((request.patch.width != null && request.patch.width < 1) || (request.patch.height != null && request.patch.height < 1)) {
      return { ok: false, file, message: "Element dimensions must be at least one composition pixel." };
    }
    const timelinePlacement = composition.meta?.timelineFile
      ? composition.timeline?.items.find((placement) => placement.id === request.objectId)
      : undefined;
    const projectedType = this.probed.get(request.compositionKey)?.find((item) => item.id === request.objectId)?.content.type;
    if (timelinePlacement && (timelinePlacement.content?.type ?? projectedType) !== "audio") {
      const timelineFile = composition.meta!.timelineFile!;
      const revision = await this.project.readSourceRevision(timelineFile);
      if (!revision || revision.text == null) return { ok: false, file: timelineFile, message: `Could not read ${timelineFile}.` };
      let document: CompositionTimelineDocument;
      try {
        document = parsedTimelineDocument(revision.text);
      } catch (error) {
        return { ok: false, file: timelineFile, message: `${timelineFile} is not a valid FrameDiff timeline document: ${error instanceof Error ? error.message : String(error)}` };
      }
      const placement = document.items.find((item) => item.id === request.objectId);
      if (!placement) return { ok: false, file: timelineFile, message: `Timeline document ${timelineFile} has no placement named "${request.objectId}".` };
      const node = [...this.previews]
        .filter((preview) => preview.compositionKey === request.compositionKey)
        .flatMap((preview) => previewNodes(preview))
        .find((candidate) => candidate.ref.objectId === request.objectId);
      const currentRect = placement.layout?.rect
        ?? (node
          ? [node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height] as const
          : [0, 0, composition.width, composition.height] as const);
      const authoredX = placement.layout ? currentRect[0] : node?.properties.x ?? 0;
      const authoredY = placement.layout ? currentRect[1] : node?.properties.y ?? 0;
      const rounded = (value: number) => Math.round(value * 1_000) / 1_000;
      placement.layout = {
        ...placement.layout,
        rect: [
          rounded(request.patch.x == null ? currentRect[0] : currentRect[0] + request.patch.x - authoredX),
          rounded(request.patch.y == null ? currentRect[1] : currentRect[1] + request.patch.y - authoredY),
          rounded(request.patch.width ?? currentRect[2]),
          rounded(request.patch.height ?? currentRect[3]),
        ],
        fit: placement.layout?.fit ?? ((placement.content?.type ?? projectedType) === "shape" ? "fill" : "cover"),
        cornerRadius: placement.layout?.cornerRadius ?? 0,
        opacity: placement.layout?.opacity ?? 1,
      };
      document.version = 2;
      try {
        defineTimelineDocument(document);
      } catch (error) {
        return { ok: false, file: timelineFile, message: `The canvas edit would make ${timelineFile} invalid: ${error instanceof Error ? error.message : String(error)}` };
      }
      const committed = await this.commitSourceText(
        request.label ?? `Edit ${request.objectId} layout`,
        revision,
        `${JSON.stringify(document, null, 2)}\n`,
        request.groupId,
      );
      if (!committed.ok) return { ok: false, file: timelineFile, message: committed.message, receipt: committed.receipt, conflicts: committed.conflicts };
      composition.timeline = document;
      await this.refreshEditedComposition(request.compositionKey);
      return { ok: true, file: timelineFile, receipt: committed.receipt };
    }
    const binding = this.documentBinding(composition, request.objectId);
    if (binding) {
      return this.editJsonDocumentValues({
        compositionKey: request.compositionKey,
        file: binding.file,
        edits: entries.map(([property, value]) => ({ pointer: appendJsonPointer(binding.pointer, property), value })),
        label: request.label ?? `Edit ${request.objectId} geometry`,
        groupId: request.groupId,
      });
    }
    if (!file) return { ok: false, message: "This composition has no editable HTML source." };
    if (composition.meta?.sourceFormat === "generated") return { ok: false, file, message: "Generated HTML must be unrolled before direct manipulation." };
    const attributes: Record<string, number> = {};
    for (const [property, value] of entries) attributes[`data-fd-${property}`] = Math.round(value * 1_000) / 1_000;
    const revision = await this.project.readSourceRevision(file);
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
    const revision = await this.project.readSourceRevision(file);
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
    return this.project.readSource(file);
  }

  public async listAssets() {
    const [manifest, cache] = await Promise.all([this.project.getAssets(), this.project.listCache()]);
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

  public async uploadAsset(file: File): Promise<string | null> {
    const assetId = await this.project.uploadAsset(file);
    if (assetId) {
      await this.loadAssets();
      // Mounted compositions capture their resolver at setup time. Force them through a
      // fresh mount so a just-imported asset:// id is available immediately rather than
      // only after the next composition switch or page reload.
      for (const preview of this.previews) {
        preview.mountedKey = undefined;
        this.renderPreview(preview);
      }
      for (const listener of this.bakeInputListeners) listener();
    }
    return assetId;
  }

  public getGitStatus(): Promise<string[] | null> {
    return this.project.gitDirty();
  }

  public commit(message: string): Promise<string | null> {
    return this.project.gitCommit(message);
  }

  public async renderComposition(
    compositionKey: string,
    onProgress: (progress: RenderProgressSnapshot) => void,
  ): Promise<RenderResult> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    await this.assetsReady;
    const { exportVideo } = await loadVideoExporter();
    const window = composition.meta?.render;
    const buffer = await exportVideo(composition, {
      width: composition.width,
      height: composition.height,
      codec: "avc1.640028",
      muxerCodec: "avc",
      bitrate: 8_000_000,
      resolver: this.resolver,
      registry: this.registry,
      // Render must materialize nested image/audio outputs exactly as preview and bake do.
      // Without this the export mounts them as ordinary nested comps whose pinned take is
      // fetched by an unawaited setup(), while the audio scan is one synchronous pass — so
      // the media never arrives in time and the render silently disagrees with the preview.
      resolveCompositionOutput: this.resolveCompositionOutput,
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
    const { captureCompositeFrame } = await loadFrameCapture();
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
    return (await this.project.listCache()).map((entry) => ({
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

  public async getCompositionBakeInputs(
    compositionKey: string,
    outputKind?: CompositionOutputKind,
  ): Promise<CompositionBakeInputsSnapshot> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition: ${compositionKey}`);
    await this.assetsReady;
    // The manifest is mutable project metadata; do not let a long-lived Studio session fingerprint
    // an asset:// reference from a stale in-memory mapping.
    await this.loadAssets();
    const inputs: Record<string, string> = {};
    const missing: string[] = [];
    const kind = outputKind ?? composition.meta?.output ?? "video";
    inputs["framediff://output-kind"] = await hashString(kind);
    for (const path of compositionSourcePaths(this.registry, compositionKey)) {
      const source = await this.project.readSource(path);
      if (source == null) missing.push(path);
      else inputs[path] = await hashString(source);
    }
    for (const key of compositionRenderKeys(this.registry, compositionKey)) {
      inputs[`composition://${key}`] = await compositionRuntimeHash(this.registry[key]);
    }
    for (const assetId of compositionAssetIds(this.registry, compositionKey)) {
      const asset = this.manifest?.assets[assetId];
      if (!asset) missing.push(`asset://${assetId}`);
      else inputs[`asset://${assetId}`] = asset.contentHash;
    }
    return { inputs, missing: [...new Set(missing)] };
  }

  private readonly resolveCompositionOutput = (
    compositionRef: string,
    outputKind: CompositionOutputKind,
  ): Promise<string> => {
    const compositionKey = resolveCompositionKey(this.registry, compositionRef);
    if (!compositionKey) return Promise.reject(new Error(`Unknown composition output: ${compositionRef}`));
    const requestKey = `${compositionKey}:${outputKind}`;
    const existing = this.outputResolutions.get(requestKey);
    if (existing) return existing;
    const pending = this.resolveCompositionOutputNow(compositionKey, outputKind)
      .finally(() => {
        if (this.outputResolutions.get(requestKey) === pending) this.outputResolutions.delete(requestKey);
      });
    this.outputResolutions.set(requestKey, pending);
    return pending;
  };

  private async resolveCompositionOutputNow(
    compositionKey: string,
    outputKind: CompositionOutputKind,
  ): Promise<string> {
    const composition = this.registry[compositionKey];
    if (!composition) throw new Error(`Unknown composition output: ${compositionKey}`);
    const declared = composition.meta?.output ?? "video";
    if (declared !== outputKind) {
      throw new Error(`${composition.id} declares ${declared} output, not ${outputKind}.`);
    }
    const fingerprint = await this.getCompositionBakeInputs(compositionKey, outputKind);
    if (fingerprint.missing.length) {
      throw new Error(`Cannot materialize ${composition.id}: ${fingerprint.missing.join(", ")}.`);
    }
    const hashes = new Map<string, string | null>(Object.entries(fingerprint.inputs));
    const current = (await this.project.listCache())
      .filter((entry) =>
        entry.meta?.compId === composition.id
        && artifactStatusFromInputs(entry.meta.inputs, hashes) === "current")
      .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
    const cachedName = current?.contentHash ?? current?.name;
    if (cachedName) return this.project.cacheUrl(cachedName);
    const baked = await this.bakeComposition(compositionKey, () => undefined, outputKind);
    this.cacheProbe = null;
    return this.project.cacheUrl(baked.filename);
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
    const fingerprint = await this.getCompositionBakeInputs(compositionKey, kind);
    if (fingerprint.missing.length) {
      throw new Error(`Cannot bake with unresolved render inputs: ${fingerprint.missing.join(", ")}.`);
    }
    let blob: Blob;
    if (kind === "audio") {
      if (!("recipe" in composition)) throw new Error("Audio bakes require a generative composition with a pinned take.");
      const recipe = (composition as GenerativeComposition).recipe;
      const pinned = (await this.project.getGenerationJobs(recipe.id))?.takes.find((take) => take.generator.take === (recipe.take ?? 0));
      if (!pinned) throw new Error(`${composition.id} needs a pinned audio take before it can be baked.`);
      onProgress({ phase: "prepare", completed: 0, total: 1 });
      const cached = await this.project.readCache(pinned.contentHash);
      if (!cached) throw new Error("Pinned audio bytes are unavailable.");
      blob = cached;
      onProgress({ phase: "audio", completed: 1, total: 1 });
      onProgress({ phase: "finalize", completed: 1, total: 1 });
    } else if (kind === "image") {
      onProgress({ phase: "prepare", completed: 0, total: 1 });
      const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.floor(composition.meta?.outputFrame ?? 0)));
      const { captureCompositeFrame } = await loadFrameCapture();
      const canvas = await captureCompositeFrame(composition, frame, {
        width: composition.width,
        height: composition.height,
        resolver: this.resolver,
        registry: this.registry,
        resolveCompositionOutput: this.resolveCompositionOutput,
      });
      onProgress({ phase: "render", completed: 1, total: 1 });
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG encoding failed")), "image/png");
      });
      onProgress({ phase: "finalize", completed: 1, total: 1 });
    } else {
      const { exportVideo } = await loadVideoExporter();
      const buffer = await exportVideo(composition, {
        width: composition.width,
        height: composition.height,
        codec: "avc1.640028",
        muxerCodec: "avc",
        bitrate: Math.round(composition.width * composition.height * composition.fps * 0.2),
        resolver: this.resolver,
        registry: this.registry,
        resolveCompositionOutput: this.resolveCompositionOutput,
        onProgress: (progress) => onProgress({
          phase: progress.phase,
          completed: progress.phase === "audio" ? progress.audioFramesScanned : progress.phase === "render" ? progress.framesEncoded : progress.phase === "finalize" ? progress.totalFrames : 0,
          total: Math.max(1, progress.totalFrames),
        }),
      });
      blob = new Blob([buffer], { type: "video/mp4" });
    }
    const hash = await hashBlob(blob);
    const extension = kind === "image" ? "png" : kind === "audio" ? (blob.type.includes("wav") ? "wav" : "mp3") : "mp4";
    await this.project.writeCache(hash, blob, `${composition.id}.${kind}.${extension}`);
    await this.project.writeArtifactMeta(hash, { compId: composition.id, label: `${composition.id} ${kind} bake`, inputs: fingerprint.inputs, createdAt: new Date().toISOString() });
    return { bytes: blob.size, filename: hash };
  }

  private async adaptVisualReference(options: {
    id: string;
    src: string;
    kind: "image" | "video";
    sourceWidth: number;
    sourceHeight: number;
    targetWidth: number;
    targetHeight: number;
    fps: number;
    durationInFrames: number;
    adaptation: VisualAdaptation;
  }): Promise<{ contentHash: string; mime: string; name: string }> {
    const relation = classifyVisualGeometry(
      options.sourceWidth,
      options.sourceHeight,
      options.targetWidth,
      options.targetHeight,
    );
    if (!relation.allowedFits.includes(options.adaptation.fit)) {
      throw new Error(
        `${options.adaptation.fit} is not valid for ${relation.label.toLowerCase()}; choose ${relation.allowedFits.join(", ")}.`,
      );
    }
    if (
      options.adaptation.fit === "cover" &&
      options.adaptation.crop &&
      !cropRegionMatchesTargetAspect(
        options.adaptation.crop,
        options.sourceWidth,
        options.sourceHeight,
        options.targetWidth,
        options.targetHeight,
      )
    ) {
      throw new Error("The crop region must match the target aspect ratio.");
    }
    const composition = adaptedVisualComposition({
      id: `${options.id}-input-adaptation`,
      src: options.src,
      kind: options.kind,
      width: options.targetWidth,
      height: options.targetHeight,
      fps: options.fps,
      durationInFrames: options.kind === "image" ? 1 : options.durationInFrames,
      adaptation: options.adaptation,
    });
    let blob: Blob;
    if (options.kind === "image") {
      const { captureCompositeFrame } = await loadFrameCapture();
      const canvas = await captureCompositeFrame(composition, 0, {
        width: options.targetWidth,
        height: options.targetHeight,
        resolver: this.resolver,
        registry: this.registry,
      });
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG encoding failed")), "image/png");
      });
    } else {
      const { exportVideo } = await loadVideoExporter();
      const buffer = await exportVideo(composition, {
        width: options.targetWidth,
        height: options.targetHeight,
        codec: "avc1.640028",
        muxerCodec: "avc",
        bitrate: Math.round(options.targetWidth * options.targetHeight * options.fps * 0.2),
        resolver: this.resolver,
        registry: this.registry,
      });
      blob = new Blob([buffer], { type: "video/mp4" });
    }
    const contentHash = await hashBlob(blob);
    const extension = options.kind === "image" ? "png" : "mp4";
    await this.project.writeCache(contentHash, blob, `${options.id}.input.${extension}`);
    return {
      contentHash,
      mime: options.kind === "image" ? "image/png" : "video/mp4",
      name: `${options.id}.${extension}`,
    };
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
    if (!sources[registryFile]) sources[registryFile] = (await this.project.readSource(registryFile)) ?? "";
    const isGenerative = request.kind === "generate";
    if (isGenerative && !request.outputKind) {
      return { ok: false, message: "Choose whether this generative composition outputs image, video, or audio." };
    }
    const isProcessing = request.kind === "processing";
    let processingRecipe = request.processingRecipe;
    if (isProcessing) {
      if (!processingRecipe) {
        const sourceKey = selectedParent ? relativeToKey : Object.entries(this.registry).find(([, value]) => value === relative)?.[0];
        if (!sourceKey) return { ok: false, message: "A processing composition needs a source composition." };
        const source = await this.getCompositionBakeInputs(sourceKey);
        if (source.missing.length) return { ok: false, message: `Cannot create processing from unresolved inputs: ${source.missing.join(", ")}.` };
        const sourceFingerprint = await hashString(JSON.stringify(Object.entries(source.inputs).sort(([left], [right]) => left.localeCompare(right))));
        processingRecipe = {
          version: 1,
          kind: "processing",
          id: `${key}-rvm`,
          inputs: [{ name: "source", contentHash: sourceFingerprint, mime: "application/vnd.framediff.composition+json" }],
          parameters: { sourceCompositionKey: sourceKey, outputChannels: ["foreground", "matte"] },
          provenance: {
            processor: "rvm",
            model: "robust-video-matting-mobilenetv3",
            modelRevision: "worker:rvm-mobilenetv3-v1",
            runtime: "framediff-processing-worker",
            runtimeRevision: "1",
          },
        };
      }
      const errors = validateProcessingRecipe(processingRecipe);
      if (errors.length) return { ok: false, message: `Invalid processing recipe: ${errors.join("; ")}` };
    }
    const isMoodboard = request.kind === "moodboard";
    const file = isGenerative ? `src/${pascal}.gen.ts` : isProcessing ? `src/${pascal}.process.ts` : isMoodboard ? `src/${pascal}.ts` : `src/${pascal}.html`;
    const module = isGenerative || isProcessing || isMoodboard ? file : `src/${pascal}.ts`;
    const generativeDataFile = `src/${pascal}.gen.json`;
    const processingDataFile = `src/${pascal}.process.json`;
    const documentFile = `src/${pascal}.comp.json`;
    const schemaFile = `src/${pascal}.schema.json`;
    const parentFile = !isProcessing && (selectedParent?.meta?.kind ?? "edit") === "edit" && selectedParent?.meta?.file?.endsWith(".html")
      ? selectedParent.meta.file
      : undefined;
    const finishCreation = async (): Promise<ProjectOperationResult> => {
      let nested = false;
      if (parentFile && selectedParent) {
        const timelineFile = selectedParent.meta?.timelineFile;
        if (timelineFile && selectedParent.timeline) {
          const timelineRevision = await this.project.readSourceRevision(timelineFile);
          if (timelineRevision?.text) {
            try {
              const currentTimeline = parsedTimelineDocument(timelineRevision.text);
              const baseId = `nested-${kebabName(pascal)}`;
              const ids = new Set(currentTimeline.items.map((item) => item.id));
              let id = baseId;
              for (let suffix = 2; ids.has(id); suffix += 1) id = `${baseId}-${suffix}`;
              const outputKind: CompositionOutputKind = isGenerative
                ? request.outputKind!
                : isProcessing
                  ? "video"
                : isMoodboard
                  ? "image"
                  : "video";
              const placementKind = outputKind === "audio" ? "audio" : "video";
              const layer = Math.max(-1, ...currentTimeline.items
                .filter((item) => timelinePlacementKind(item, undefined, this.registry) === placementKind)
                .map((item) => item.layer ?? 0)) + 1;
              const nextTimeline: CompositionTimelineDocument = {
                version: 2,
                items: [...currentTimeline.items, {
                  id,
                  name: pascal,
                  from: 0,
                  durationInFrames: request.durationInFrames,
                  layer,
                  ...(outputKind === "audio"
                    ? { volume: 1 }
                    : { layout: { rect: [0, 0, selectedParent.width, selectedParent.height] as [number, number, number, number], fit: "cover" as const, cornerRadius: 0, opacity: 1 } }),
                  content: { type: "nested", composition: key },
                }],
              };
              nested = (await this.commitSourceText(`Nest ${pascal} in ${selectedParent.id}`, timelineRevision, `${JSON.stringify(nextTimeline, null, 2)}\n`)).ok;
            } catch { /* leave the new composition top-level when the parent's timeline is invalid */ }
          }
        } else {
          const parentRevision = await this.project.readSourceRevision(parentFile);
          const placedParentSource = parentRevision?.text == null ? null : insertNestedHtmlComposition(parentRevision.text, selectedParent.id, {
            compId: pascal,
            name: pascal,
            from: 0,
            durationInFrames: request.durationInFrames,
          });
          if (parentRevision && placedParentSource) nested = await this.project.writeSource(parentFile, placedParentSource);
        }
      }
      return {
        ok: true,
        message: nested
          ? `Created ${pascal}, registered “${key}”, and nested it under ${selectedParent!.id}.`
          : `Created ${pascal} and registered “${key}” at the top level.`,
        compositionKey: key,
      };
    };
    if (isProcessing) {
      const recipeFingerprint = await fingerprintProcessingRecipe(processingRecipe!);
      const document: ProcessingCompositionDocument = {
        recipe: processingRecipe!,
        recipeFingerprint,
        artifact: null,
        pinnedRecipeFingerprint: null,
      };
      if (!(await this.project.writeSource(processingDataFile, `${JSON.stringify(document, null, 2)}\n`))) {
        return { ok: false, message: `Could not write ${processingDataFile}.` };
      }
      const source = processingCompositionModule({
        id: pascal,
        exportName: varName,
        file,
        dataFile: processingDataFile,
        width: relative.width,
        height: relative.height,
        fps: relative.fps,
        durationInFrames: request.durationInFrames,
      });
      if (!(await this.project.writeSource(file, source))) return { ok: false, message: `Wrote ${processingDataFile}, but could not write ${file}.` };
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, file) });
      if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) {
        return { ok: false, message: `Wrote ${file}, but could not register it in ${registryFile}.` };
      }
      return finishCreation();
    }
    if (isGenerative) {
      const duration = Number((request.durationInFrames / relative.fps).toFixed(6));
      const output = request.outputKind!;
      const model = DEFAULT_GEN_MODEL_BY_OUTPUT[output];
      const initialAspect = nearestGenerativeAspect(relative.width, relative.height);
      const recipeData: Record<string, unknown> = {
        provider: "fal",
        output,
        model,
        prompt: "Describe the shot you want to generate.",
        fps: relative.fps,
        take: 0,
      };
      if (output === "video") Object.assign(recipeData, {
        tier: "fast",
        resolution: "720p",
        duration,
        aspect: initialAspect,
        audio: true,
      });
      else if (output === "image") Object.assign(recipeData, {
        aspect: initialAspect === "21:9" ? "16:9" : initialAspect,
      });
      else Object.assign(recipeData, {
        duration,
        speed: 1,
        pitch: 0,
      });
      if (!(await this.project.writeSource(generativeDataFile, `${JSON.stringify(recipeData, null, 2)}\n`))) {
        return { ok: false, message: `Could not write ${generativeDataFile}.` };
      }
      const recipe = generativeCompositionModule({
        id: pascal,
        exportName: varName,
        file,
        dataFile: generativeDataFile,
        width: relative.width,
        height: relative.height,
        fps: relative.fps,
        durationInFrames: request.durationInFrames,
      });
      if (!(await this.project.writeSource(file, recipe))) return { ok: false, message: `Wrote ${generativeDataFile}, but could not write ${file}.` };
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, file) });
      if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) {
        return { ok: false, message: `Wrote ${file}, but could not register it in ${registryFile}.` };
      }
      return finishCreation();
    }
    if (isMoodboard) {
      const moodboardDocument = {
        camera: { x: Math.round(relative.width * 0.08), y: Math.round(relative.height * 0.12), zoom: 1 },
        items: [
          { id: "note-1", type: "note", x: 180, y: 180, width: 300, text: "Double-click this note to edit it." },
          { id: "note-2", type: "note", x: 560, y: 340, width: 280, rotation: -2, text: "Drag cards, pan the board, and scroll to zoom." },
        ],
      };
      if (!(await this.project.writeSource(documentFile, `${JSON.stringify(moodboardDocument, null, 2)}\n`))) return { ok: false, message: `Could not write ${documentFile}.` };
      if (!(await this.project.writeSource(file, moodboardCompositionModule({
        id: pascal,
        exportName: varName,
        file,
        documentFile,
        width: relative.width,
        height: relative.height,
        fps: relative.fps,
        durationInFrames: request.durationInFrames,
      })))) return { ok: false, message: `Wrote ${documentFile}, but could not write ${file}.` };
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, file) });
      if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) {
        return { ok: false, message: `Wrote ${file}, but could not register it in ${registryFile}.` };
      }
      return finishCreation();
    }
    if (request.kind === "custom") {
      if (!(await this.project.writeSource(file, customCompositionScaffold({
        id: pascal,
        exportName: varName,
        file,
        module,
        documentFile,
        schemaFile,
        kind: request.kind,
        width: relative.width,
        height: relative.height,
        fps: relative.fps,
        duration: request.durationInFrames,
      })))) return { ok: false, message: `Could not write ${file}.` };
      if (!(await this.project.writeSource(module, htmlCompositionModule(file, varName)))) {
        return { ok: false, message: `Wrote ${file}, but could not write ${module}.` };
      }
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, module) });
      if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) {
        return { ok: false, message: `Wrote ${file} and ${module}, but could not register them in ${registryFile}.` };
      }
      return finishCreation();
    }
    const baseScaffoldOptions: HtmlCompositionScaffoldOptions = {
      id: pascal,
      exportName: varName,
      file,
      module,
      documentFile,
      schemaFile,
      kind: request.kind,
      width: relative.width,
      height: relative.height,
      fps: relative.fps,
      duration: request.durationInFrames,
    };
    const scaffoldData = compositionScaffoldData(baseScaffoldOptions);
    const timelineFile = scaffoldData.timeline ? `src/${pascal}.timeline.json` : undefined;
    const scaffoldOptions = { ...baseScaffoldOptions, timelineFile };
    const scaffold = htmlCompositionScaffold(scaffoldOptions);
    if (!(await this.project.writeSource(file, scaffold))) return { ok: false, message: `Could not write ${file}.` };
    if (!(await this.project.writeSource(documentFile, `${JSON.stringify(scaffoldData.document, null, 2)}\n`))) {
      return { ok: false, message: `Wrote ${file}, but could not write ${documentFile}.` };
    }
    if (!(await this.project.writeSource(schemaFile, `${JSON.stringify(scaffoldData.schema, null, 2)}\n`))) {
      return { ok: false, message: `Wrote ${file} and ${documentFile}, but could not write ${schemaFile}.` };
    }
    if (timelineFile && scaffoldData.timeline && !(await this.project.writeSource(timelineFile, `${JSON.stringify(scaffoldData.timeline, null, 2)}\n`))) {
      return { ok: false, message: `Wrote the composition files, but could not write ${timelineFile}.` };
    }
    if (!(await this.project.writeSource(module, htmlCompositionModule(file, varName, {
      documentFile,
      schemaFile,
      bindings: scaffoldData.bindings,
      timelineFile,
    })))) return { ok: false, message: `Wrote ${file}, but could not write ${module}.` };
    const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, module) });
    if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) {
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
    if (!sources[registryFile]) sources[registryFile] = (await this.project.readSource(registryFile)) ?? "";
    let pascal = `${source.id}Copy`;
    for (let index = 2; this.registry[kebabName(pascal)] || Object.values(this.registry).some((entry) => entry.id === pascal); index += 1) {
      pascal = `${source.id}Copy${index}`;
    }
    const key = kebabName(pascal);
    const varName = `${camelName(pascal)}Comp`;
    const sourceFile = source.meta?.file;
    if (!sourceFile) return { ok: false, message: `${source.id} does not declare data-fd-source.` };
    const sourceDirectory = sourceFile.split("/").slice(0, -1).join("/") || "src";
    if ("recipe" in source) {
      const recipeFile = `${sourceDirectory}/${pascal}.gen.ts`;
      const sourceRecipe = (source as GenerativeComposition).recipe;
      if (sourceRecipe.dataFile) {
        const dataFile = `${sourceDirectory}/${pascal}.gen.json`;
        const data = { ...genRecipeDataOf(sourceRecipe), take: 0 };
        if (!(await this.project.writeSource(dataFile, `${JSON.stringify(data, null, 2)}\n`))) return { ok: false, message: `Could not fork ${source.id}'s recipe document.` };
        if (!(await this.project.writeSource(recipeFile, generativeCompositionModule({
          id: pascal,
          exportName: varName,
          file: recipeFile,
          dataFile,
          width: source.width,
          height: source.height,
          fps: source.fps,
          durationInFrames: source.durationInFrames,
        })))) return { ok: false, message: `Wrote ${dataFile}, but could not fork ${source.id}'s module.` };
        const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, recipeFile) });
        if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) return { ok: false, message: `Forked ${recipeFile}, but could not register it.` };
        return { ok: true, message: `Forked ${source.id} as ${pascal}; the new JSON recipe starts without a pinned take.`, compositionKey: key };
      }
      const sourceText = sources[sourceFile] ?? await this.project.readSource(sourceFile);
      const transformed = sourceText == null ? null : transformCopiedCompText(sourceText, {
        oldId: source.id,
        newId: pascal,
        newVar: varName,
        newFile: recipeFile,
        library: toLibrary || source.meta?.library === true,
      });
      if (!transformed || !(await this.project.writeSource(recipeFile, transformed))) return { ok: false, message: `Could not fork ${source.id}'s generative recipe.` };
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, recipeFile) });
      if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) return { ok: false, message: `Forked ${recipeFile}, but could not register it.` };
      return { ok: true, message: `Forked ${source.id} as ${pascal}; the new recipe starts without a pinned take.`, compositionKey: key };
    }
    if (source.meta?.kind === "moodboard" && source.meta.document?.file) {
      const documentFile = `${sourceDirectory}/${pascal}.comp.json`;
      const moduleFile = `${sourceDirectory}/${pascal}.ts`;
      const documentText = sources[source.meta.document.file] ?? await this.project.readSource(source.meta.document.file);
      if (documentText == null || !(await this.project.writeSource(documentFile, documentText))) return { ok: false, message: `Could not copy ${source.meta.document.file}.` };
      if (!(await this.project.writeSource(moduleFile, moodboardCompositionModule({
        id: pascal,
        exportName: varName,
        file: moduleFile,
        documentFile,
        width: source.width,
        height: source.height,
        fps: source.fps,
        durationInFrames: source.durationInFrames,
      })))) return { ok: false, message: `Copied ${documentFile}, but could not write ${moduleFile}.` };
      const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, moduleFile) });
      if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) return { ok: false, message: `Copied ${moduleFile}, but could not register it.` };
      return { ok: true, message: `Duplicated ${source.id} as ${pascal}.`, compositionKey: key };
    }
    if (source.meta?.sourceFormat === "generated") {
      return { ok: false, message: `${source.id} is generated by a shared composition factory; duplicate its data/factory entry in code instead.` };
    }
    let text = sources[sourceFile] ?? await this.project.readSource(sourceFile);
    if (text == null) return { ok: false, message: `Could not read ${sourceFile}.` };
    const directory = sourceDirectory;
    const file = `${directory}/${pascal}.html`;
    const module = `${directory}/${pascal}.ts`;
    const sourceDocumentFile = source.meta?.document?.file;
    const sourceSchemaFile = source.meta?.document?.schema;
    const sourceTimelineFile = source.meta?.timelineFile;
    const documentFile = sourceDocumentFile ? `${directory}/${pascal}.comp.json` : undefined;
    const schemaFile = sourceSchemaFile ? `${directory}/${pascal}.schema.json` : undefined;
    const timelineFile = sourceTimelineFile ? `${directory}/${pascal}.timeline.json` : undefined;
    text = rewriteHtmlAttribute(text, source.id, "data-fd-id", pascal) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-source", file) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-module", module) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-export", varName) ?? text;
    text = rewriteHtmlAttribute(text, pascal, "data-fd-library", toLibrary || source.meta?.library === true) ?? text;
    if (documentFile) text = rewriteHtmlAttribute(text, pascal, "data-fd-document", documentFile) ?? text;
    if (schemaFile) text = rewriteHtmlAttribute(text, pascal, "data-fd-schema", schemaFile) ?? text;
    if (timelineFile) text = rewriteHtmlAttribute(text, pascal, "data-fd-timeline-source", timelineFile) ?? text;
    if (!(await this.project.writeSource(file, text))) return { ok: false, message: `Could not write ${file}.` };
    if (sourceDocumentFile && documentFile) {
      const documentText = sources[sourceDocumentFile] ?? await this.project.readSource(sourceDocumentFile);
      if (documentText == null || !(await this.project.writeSource(documentFile, documentText))) return { ok: false, message: `Wrote ${file}, but could not copy ${sourceDocumentFile}.` };
    }
    if (sourceSchemaFile && schemaFile) {
      const schemaText = sources[sourceSchemaFile] ?? await this.project.readSource(sourceSchemaFile);
      if (schemaText == null || !(await this.project.writeSource(schemaFile, schemaText))) return { ok: false, message: `Wrote ${file}, but could not copy ${sourceSchemaFile}.` };
    }
    if (sourceTimelineFile && timelineFile) {
      const timelineText = sources[sourceTimelineFile] ?? await this.project.readSource(sourceTimelineFile);
      if (timelineText == null || !(await this.project.writeSource(timelineFile, timelineText))) return { ok: false, message: `Wrote ${file}, but could not copy ${sourceTimelineFile}.` };
    }
    const setupImport = source.meta?.module && source.meta?.exportName
      ? `import { ${source.meta.exportName} as sourceComposition } from "${relModule(module, source.meta.module)}";`
      : undefined;
    if (!(await this.project.writeSource(module, htmlCompositionModule(file, varName, {
      setupImport,
      documentFile,
      schemaFile,
      bindings: source.meta?.document?.bindings,
      timelineFile,
    })))) return { ok: false, message: `Wrote ${file}, but could not write ${module}.` };
    const inserted = insertRegistryEntry(registryFile, sources, { key, varName, importFrom: relModule(registryFile, module) });
    if (!inserted || !(await this.project.writeSource(registryFile, inserted.text))) return { ok: false, message: `Wrote ${file}, but could not register it.` };
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
    if (!sources[registryFile]) sources[registryFile] = (await this.project.readSource(registryFile)) ?? "";
    const exportName = composition.meta?.exportName ?? findCompExportName(composition.id, sources)?.varName;
    if (!exportName) return { ok: false, message: `${composition.id} does not declare data-fd-export and cannot be removed safely.` };
    const escapedId = composition.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedKey = compositionKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nestedReference = new RegExp(`\\bdata-fd-comp\\s*=\\s*["']${escapedId}["']`);
    const documentReference = new RegExp(`(?:"composition"\\s*:\\s*"(?:${escapedKey}|${escapedId})"|comp:\\/\\/(?:${escapedKey}|${escapedId})(?:"|\\b))`);
    const ownedFiles = new Set([
      composition.meta?.file,
      composition.meta?.module,
      composition.meta?.document?.file,
      composition.meta?.document?.schema,
      composition.meta?.timelineFile,
      "recipe" in composition ? (composition as GenerativeComposition).recipe.dataFile : undefined,
    ].filter((entry): entry is string => !!entry));
    const references = Object.entries(sources)
      .filter(([file]) => file !== registryFile && !ownedFiles.has(file))
      .filter(([, text]) => nestedReference.test(text) || documentReference.test(text))
      .map(([file]) => file);
    if (references.length) {
      return { ok: false, message: `${composition.id} is nested in ${references.join(", ")} — remove it there first.` };
    }
    const removed = removeRegistryEntry(registryFile, sources, exportName);
    if (!removed || !(await this.project.writeSource(registryFile, removed.text))) {
      return { ok: false, message: `Could not remove "${compositionKey}" from ${registryFile}.` };
    }
    const file = composition.meta?.file;
    const module = composition.meta?.module;
    const ownsSources = !!file
      && (composition.meta?.sourceFormat !== "generated" || composition.meta?.kind === "generate" || composition.meta?.kind === "moodboard")
      && !Object.entries(this.registry).some(([key, other]) => key !== compositionKey && (other.meta?.file === file || (module && other.meta?.module === module)));
    if (!ownsSources) return { ok: true, message: `Unregistered ${composition.id}; its shared source remains in place.` };
    const deletionResults = await Promise.all([...ownedFiles].map((owned) => this.project.deleteSource(owned)));
    return {
      ok: true,
      message: deletionResults.every(Boolean)
        ? `Deleted ${composition.id} and its owned HTML, module, JSON, schema, and timeline sources.`
        : `Unregistered ${composition.id}; remove its remaining source files by hand.`,
    };
  }

  public async nestComposition(targetKey: string, sourceKey: string, from: number): Promise<ProjectOperationResult> {
    const target = this.registry[targetKey];
    const source = this.registry[sourceKey];
    if (!target || !source) return { ok: false, message: "The composition is unavailable." };
    const file = target.meta?.file;
    if (!file || target.meta?.sourceFormat === "generated") return { ok: false, message: `${target.id} does not have a physical HTML source that can accept layers.` };
    let committed: ProjectEditResult;
    const timelineFile = target.meta?.timelineFile;
    if (timelineFile && target.timeline) {
      const timelineRevision = await this.project.readSourceRevision(timelineFile);
      if (!timelineRevision?.text) return { ok: false, message: `Could not read ${timelineFile}.` };
      let timeline: CompositionTimelineDocument;
      try {
        timeline = parsedTimelineDocument(timelineRevision.text);
      } catch (error) {
        return { ok: false, message: `${timelineFile} is not a valid timeline document: ${error instanceof Error ? error.message : String(error)}` };
      }
      const baseId = `nested-${kebabName(source.id)}`;
      const ids = new Set(timeline.items.map((item) => item.id));
      let id = baseId;
      for (let suffix = 2; ids.has(id); suffix += 1) id = `${baseId}-${suffix}`;
      const layer = Math.max(-1, ...timeline.items
        .filter((item) => timelinePlacementKind(item, undefined, this.registry) === "video")
        .map((item) => item.layer ?? 0)) + 1;
      timeline = {
        version: 2,
        items: [...timeline.items, {
          id,
          name: source.id,
          from: Math.round(from),
          durationInFrames: source.durationInFrames,
          layer,
          layout: { rect: [0, 0, target.width, target.height], fit: "cover", cornerRadius: 0, opacity: 1 },
          content: { type: "nested", composition: sourceKey },
        }],
      };
      committed = await this.commitSourceText(`Nest ${source.id} in ${target.id}`, timelineRevision, `${JSON.stringify(timeline, null, 2)}\n`);
      if (committed.ok) target.timeline = timeline;
    } else {
      const revision = await this.project.readSourceRevision(file);
      const text = revision?.text;
      if (!revision || text == null) return { ok: false, message: `Could not read ${file} through the FrameDiff dev bridge.` };
      const next = insertNestedHtmlComposition(text, target.id, {
        compId: source.id,
        name: source.id,
        from,
        durationInFrames: source.durationInFrames,
      });
      if (!next) return { ok: false, message: `Could not find the ${target.id} composition root in ${file}.` };
      committed = await this.commitSourceText(`Nest ${source.id} in ${target.id}`, revision, next);
    }
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not write ${file}.` };
    return { ok: true, message: `Nested ${source.id} into ${target.id} at f${Math.round(from)}.`, compositionKey: targetKey, receipt: committed.receipt };
  }

  public async setCompositionLibrary(compositionKey: string, library: boolean): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    const file = composition?.meta?.file;
    if (!composition || !file) return { ok: false, message: "The composition does not declare its HTML source." };
    const revision = await this.project.readSourceRevision(file);
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
    const revision = await this.project.readSourceRevision(file);
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

  /** The account's voices as pickable, auditionable choices. Generated voices sort first:
   *  a project that designed its own cast cares about those, not the stock presets. */
  private async loadVoiceChoices(): Promise<{ choices: GenerativeChoiceSnapshot[]; error?: string }> {
    // The adapter method is newer than the interface's other members: an older or partial
    // project adapter simply has no voice discovery, which is not an error.
    if (typeof this.project.getProviderVoices !== "function") return { choices: [] };
    const result = await this.project.getProviderVoices();
    if ("error" in result) return { choices: [], error: result.error };
    const rank = (category?: string) => (category === "generated" ? 0 : category === "cloned" ? 1 : 2);
    const choices = result.voices
      .map((voice) => ({
        value: voice.voice_id,
        label: voice.name ?? voice.voice_id,
        group: voice.category ?? "voice",
        description: voice.description,
        previewUrl: voice.preview_url,
      }))
      .sort((a, b) => rank(a.group) - rank(b.group) || a.label.localeCompare(b.label));
    return { choices };
  }

  public async getProcessingWorkspace(compositionKey: string): Promise<ProcessingWorkspaceSnapshot | null> {
    const candidate = this.registry[compositionKey];
    if (!candidate || candidate.meta?.kind !== "processing" || !("processing" in candidate)) return null;
    const composition = candidate as ProcessingComposition;
    const document = composition.processing;
    const recipeFingerprint = await fingerprintProcessingRecipe(document.recipe);
    const artifact = document.artifact;
    const artifactErrors = artifact
      ? document.recipe.provenance.processor === RVM_PROCESSOR
        ? validateRvmArtifactManifest(artifact)
        : validateProcessingArtifactManifest(artifact)
      : [];
    const recipeInputs = new Map(document.recipe.inputs.map((input) => [input.name, input.contentHash]));
    const inputsMatch = !!artifact
      && artifact.inputs.length === recipeInputs.size
      && artifact.inputs.every((input) => recipeInputs.get(input.name) === input.contentHash);
    const status = !artifact || !document.pinnedRecipeFingerprint
      ? "missing"
      : artifactErrors.length || !inputsMatch || document.recipeFingerprint !== recipeFingerprint || artifact.recipeFingerprint !== recipeFingerprint || document.pinnedRecipeFingerprint !== recipeFingerprint
        ? "stale"
        : "current";
    return {
      compositionKey,
      recipe: document.recipe,
      artifact,
      pinnedRecipeFingerprint: document.pinnedRecipeFingerprint,
      recipeFingerprint,
      status,
    };
  }

  public async runProcessing(compositionKey: string): Promise<ProcessingOperationResult> {
    const workspace = await this.getProcessingWorkspace(compositionKey);
    if (!workspace) return { ok: false, message: "The selected composition is not a processing recipe." };
    return {
      ok: false,
      message: "No processing executor is configured for this project. Connect the hosted worker adapter, then run this pinned recipe again.",
    };
  }

  public async pinProcessingArtifact(compositionKey: string, recipeFingerprint: string): Promise<ProcessingOperationResult> {
    const candidate = this.registry[compositionKey];
    if (!candidate || candidate.meta?.kind !== "processing" || !("processing" in candidate)) {
      return { ok: false, message: "The selected composition is not a processing recipe." };
    }
    const composition = candidate as ProcessingComposition;
    const current = await fingerprintProcessingRecipe(composition.processing.recipe);
    if (recipeFingerprint !== current) return { ok: false, message: "The processing recipe changed; refresh before pinning." };
    if (!composition.processing.artifact || composition.processing.artifact.recipeFingerprint !== current) {
      return { ok: false, message: "No current processing artifact is available to pin." };
    }
    const artifactErrors = composition.processing.recipe.provenance.processor === RVM_PROCESSOR
      ? validateRvmArtifactManifest(composition.processing.artifact)
      : validateProcessingArtifactManifest(composition.processing.artifact);
    if (artifactErrors.length) return { ok: false, message: `The processing artifact is invalid: ${artifactErrors.join("; ")}` };
    const file = composition.processingDataFile;
    if (!file) return { ok: false, message: "The processing composition does not declare a writable data file." };
    const revision = await this.project.readSourceRevision(file);
    if (!revision?.text) return { ok: false, message: `Could not read ${file}.` };
    let parsed: ProcessingCompositionDocument;
    try {
      parsed = JSON.parse(revision.text) as ProcessingCompositionDocument;
    } catch {
      return { ok: false, message: `${file} is not valid JSON.` };
    }
    if (parsed.recipeFingerprint !== current) return { ok: false, message: "The processing recipe source changed; refresh before pinning." };
    const committed = await this.commitSourceText(
      `Pin ${candidate.id} processing artifact`,
      revision,
      `${JSON.stringify({ ...parsed, pinnedRecipeFingerprint: current }, null, 2)}\n`,
    );
    if (!committed.ok) return { ok: false, message: committed.message ?? "Could not pin the processing artifact.", conflicts: committed.conflicts };
    return { ok: true, message: `Pinned ${candidate.id} processing artifact.`, manifest: composition.processing.artifact, receipt: committed.receipt };
  }

  public async getGenerativeWorkspace(compositionKey: string): Promise<GenerativeWorkspaceSnapshot | null> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return null;
    const recipe = (composition as GenerativeComposition).recipe;
    const outputKind = genOutputKindOf(recipe);
    const definition = genModelOf(recipe);
    const native = genNativeDims(recipe);
    const provider = definition.provider ?? recipe.provider ?? "fal";
    const effectiveRecipe = this.voiceAnchoredRecipe(recipe);
    const liveHash = await recipeHashOf(effectiveRecipe);
    const data = await this.project.getGenerationJobs(recipe.id) ?? { jobs: [], takes: [] };
    primeGenTakes(data.takes);
    // Takes this session hasn't seen before just landed — let mounted previews re-resolve.
    const fresh = data.takes.filter((take) => !seenGenTakes.has(`${take.generator.gen}\0${take.generator.take}`));
    for (const take of fresh) seenGenTakes.add(`${take.generator.gen}\0${take.generator.take}`);
    if (fresh.length) refreshGenOutputs();
    const active = data.jobs.some((job) => job.status === "queued" || job.status === "running");
    const pinned = data.takes.find((take) =>
      take.generator.take === (recipe.take ?? 0) &&
      (take.generator.outputKind == null || take.generator.outputKind === outputKind)
    );
    const status = active
      ? "running"
      : latestFailedGenJob(data.jobs)
        ? "failed"
        : !data.takes.length
          ? "never"
          : !pinned
            ? "unpinned"
            : pinned.generator.recipeHash === liveHash
              ? "current"
              : "stale";
    const assets = await this.project.getAssets();
    const secrets = await this.project.getSecrets();
    const blockedInputs: string[] = [];
    for (const ref of recipe.refs ?? []) {
      if (!ref.src.startsWith("comp://")) continue;
      const input = this.registry[ref.src.slice("comp://".length)];
      if (!input || !("recipe" in input)) continue;
      const inputRecipe = (input as GenerativeComposition).recipe;
      const inputTakes = await this.project.getGenerationJobs(inputRecipe.id);
      const inputOutput = genOutputKindOf(inputRecipe);
      const pinned = inputTakes?.takes.some((take) =>
        take.generator.take === (inputRecipe.take ?? 0) &&
        (take.generator.outputKind == null || take.generator.outputKind === inputOutput)
      );
      if (!pinned) blockedInputs.push(input.id);
    }
    const missingRefs = (definition.requiredRefs ?? []).filter((kind) => !(recipe.refs ?? []).some((ref) => ref.kind === kind));
    const paramError = genNumericParamValidationError(effectiveRecipe, definition);
    const blockedReason = blockedInputs.length
      ? `Pin an approved take in ${[...new Set(blockedInputs)].join(", ")} before generating this composition.`
      : definition.id === "elevenlabs-direct" && !effectiveRecipe.voice?.trim()
        ? "Set an ElevenLabs voice_id in the recipe before generating this composition."
      : paramError
        ? paramError
      : missingRefs.length
        ? `Add a required ${missingRefs.map((kind) => kind === "endImage" ? "end-frame" : kind).join(" and ")} reference before generating with ${definition.name}.`
        : undefined;
    const labelFor = (source: string) => source.startsWith("asset://")
      ? assets?.assets[source.slice(8)]?.name ?? source
      : source.startsWith("comp://")
        ? this.registry[source.slice(7)]?.id ?? source
        : source;
    const refSnapshot = (ref: GenRef, contentHash?: string) => {
      const source = ref.src.startsWith("comp://")
        ? this.registry[ref.src.slice("comp://".length)]
        : undefined;
      const visual = outputKind !== "audio" &&
        (ref.kind === "image" || ref.kind === "endImage" || ref.kind === "video");
      const geometry = source && visual
        ? classifyVisualGeometry(source.width, source.height, native.width, native.height)
        : undefined;
      return {
        ...ref,
        label: labelFor(ref.src),
        ...(contentHash ? { contentHash } : {}),
        ...(source && visual ? {
          sourceWidth: source.width,
          sourceHeight: source.height,
          targetWidth: native.width,
          targetHeight: native.height,
          geometry,
          adaptation: ref.adapt,
        } : {}),
      };
    };
    const takeSettings = (take: (typeof data.takes)[number]) => {
      const historical = take.generator.recipe;
      if (!historical) return undefined;
      const historicalRecipe: GenRecipe = { id: recipe.id, ...historical };
      const historicalDefinition = genModelOf(historicalRecipe);
      return {
        model: historicalRecipe.model ?? historicalDefinition.id,
        modelName: historicalDefinition.name,
        outputKind: genOutputKindOf(historicalRecipe),
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
        refs: (historicalRecipe.refs ?? []).map((ref, index) =>
          refSnapshot(ref, take.generator.inputs?.[index]?.contentHash)),
      };
    };
    const desiredOutput = outputKind !== "audio" && recipe.desiredOutput
      ? {
          width: recipe.desiredOutput.width,
          height: recipe.desiredOutput.height,
          adaptation: {
            fit: recipe.desiredOutput.fit,
            crop: recipe.desiredOutput.crop,
            matte: recipe.desiredOutput.matte,
          },
          geometry: classifyVisualGeometry(
            native.width,
            native.height,
            recipe.desiredOutput.width,
            recipe.desiredOutput.height,
          ),
        }
      : undefined;
    // Only pay for account discovery when a param actually needs it.
    const voiceChoices = definition.params.some((param) => param.dynamicOptions === "voices")
      ? await this.loadVoiceChoices()
      : { choices: [] as GenerativeChoiceSnapshot[] };
    return {
      compositionKey,
      recipeId: recipe.id,
      file: recipe.dataFile ?? recipe.file,
      model: definition.id,
      modelName: definition.name,
      outputKind,
      ...(outputKind !== "audio" ? { nativeWidth: native.width, nativeHeight: native.height, desiredOutput } : {}),
      models: genModelsForOutput(outputKind).map((model) => ({ id: model.id, name: model.name, vendor: model.vendor, baseline: model.baseline })),
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
        // Account-scoped options (voice ids) are discovered, never declared.
        ...(param.dynamicOptions === "voices"
          ? voiceChoices.error
            ? { choicesError: voiceChoices.error }
            : { choices: voiceChoices.choices }
          : {}),
      })),
      refs: (recipe.refs ?? []).map((ref) => refSnapshot(ref)),
      compositions: Object.entries(this.registry)
        .filter(([key, candidate]) => key !== compositionKey && candidate.id !== composition.id)
        .map(([key, candidate]) => ({
          key,
          id: candidate.id,
          outputKind: candidate.meta?.output ?? "video",
          width: candidate.width,
          height: candidate.height,
        })),
      takes: data.takes.map((take) => {
        const settings = takeSettings(take);
        return {
          take: take.generator.take, assetId: take.assetId, contentHash: take.contentHash, bytes: take.bytes,
          recipeHash: take.generator.recipeHash, endpoint: take.generator.endpoint, seed: take.generator.seed, at: take.generator.at,
          outputKind: take.generator.outputKind ?? settings?.outputKind ?? outputKind,
          settings,
        };
      }),
      jobs: data.jobs.map((job) => ({
        id: job.id,
        providerJobId: job.providerJobId,
        status: job.status,
        error: job.error,
        take: job.take,
        recipeHash: job.recipeHash,
        at: job.at,
        doneAt: job.doneAt,
      })),
      pinnedTake: recipe.take ?? 0,
      liveHash,
      status,
      providerReady: !!secrets?.providers[provider]?.set,
      providerName: provider === "byteplus"
        ? "BytePlus ModelArk"
        : provider === "elevenlabs"
          ? "ElevenLabs"
          : "fal.ai",
      blockedReason,
    };
  }

  public async updateGenerativeRecipe(compositionKey: string, patch: Record<string, unknown>): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const file = recipe.dataFile ?? recipe.file;
    if (!file) return { ok: false, message: "The recipe does not declare its source file." };
    const revision = await this.project.readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${file}.` };
    const lockedOutput = genOutputKindOf(recipe);
    const { model: requestedModel, output: requestedOutput, ...remainingPatch } = patch;
    if (requestedOutput != null && requestedOutput !== lockedOutput) {
      return {
        ok: false,
        message: `This composition is locked to ${lockedOutput}. Create a new generative composition for ${String(requestedOutput)} output.`,
      };
    }
    if (typeof requestedModel === "string") {
      const requestedDefinition = GEN_MODELS[requestedModel];
      if (!requestedDefinition) return { ok: false, message: `Unknown generative model: ${requestedModel}.` };
      if (requestedDefinition.output !== lockedOutput) {
        return {
          ok: false,
          message: `${requestedDefinition.name} produces ${requestedDefinition.output}; this composition is locked to ${lockedOutput}.`,
        };
      }
    }
    const remapped = typeof requestedModel === "string"
      ? remapRecipeForModel(recipe, requestedModel)
      : { next: recipe, droppedRefs: [] };
    const base = { ...remapped.next, output: lockedOutput };
    let next = withRecipe(base, remainingPatch as Partial<GenRecipe>);
    const paramError = genNumericParamValidationError(next);
    if (paramError) return { ok: false, message: paramError };
    const previousNative = genNativeDims(recipe);
    const nextNative = genNativeDims(next);
    const nativeShapeChanged =
      previousNative.width !== nextNative.width ||
      previousNative.height !== nextNative.height;
    if (nativeShapeChanged) {
      if (
        !Object.prototype.hasOwnProperty.call(remainingPatch, "desiredOutput") &&
        next.desiredOutput?.fit === "cover" &&
        next.desiredOutput.crop
      ) {
        next = {
          ...next,
          desiredOutput: {
            ...next.desiredOutput,
            crop: retargetCropRegion(
              next.desiredOutput.crop,
              previousNative.width,
              previousNative.height,
              next.desiredOutput.width,
              next.desiredOutput.height,
              nextNative.width,
              nextNative.height,
              next.desiredOutput.width,
              next.desiredOutput.height,
            ),
          },
        };
      }
      if (
        !Object.prototype.hasOwnProperty.call(remainingPatch, "refs") &&
        next.refs?.some((ref) => ref.adapt?.fit === "cover" && ref.adapt.crop && ref.src.startsWith("comp://"))
      ) {
        next = {
          ...next,
          refs: next.refs.map((ref) => {
            if (ref.adapt?.fit !== "cover" || !ref.adapt.crop || !ref.src.startsWith("comp://")) return ref;
            const sourceComposition = this.registry[ref.src.slice("comp://".length)];
            if (!sourceComposition) return ref;
            return {
              ...ref,
              adapt: {
                ...ref.adapt,
                crop: retargetCropRegion(
                  ref.adapt.crop,
                  sourceComposition.width,
                  sourceComposition.height,
                  previousNative.width,
                  previousNative.height,
                  sourceComposition.width,
                  sourceComposition.height,
                  nextNative.width,
                  nextNative.height,
                ),
              },
            };
          }),
        };
      }
    }
    if (next.desiredOutput) {
      if (lockedOutput === "audio") {
        return { ok: false, message: "Audio output has no visual shape to adapt." };
      }
      const { width, height, fit } = next.desiredOutput;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        return { ok: false, message: "Desired output width and height must be positive numbers." };
      }
      const native = genNativeDims(next);
      const geometry = classifyVisualGeometry(native.width, native.height, width, height);
      if (!geometry.allowedFits.includes(fit)) {
        return {
          ok: false,
          message: `${fit} is not valid for ${geometry.label.toLowerCase()}; choose ${geometry.allowedFits.join(", ")}.`,
        };
      }
      if (
        fit === "cover" &&
        next.desiredOutput.crop &&
        !cropRegionMatchesTargetAspect(next.desiredOutput.crop, native.width, native.height, width, height)
      ) {
        return { ok: false, message: "The output crop region must match the desired output aspect ratio." };
      }
    }
    if (Array.isArray(next.refs)) {
      const accepted: GenRef[] = [];
      for (const ref of next.refs) {
        const decision = genRefAccept({ ...next, refs: accepted }, genModelOf(next), ref.kind);
        if (!decision.ok) return { ok: false, message: decision.why ?? "That input reference is not supported." };
        if (ref.adapt && !ref.src.startsWith("comp://")) {
          return { ok: false, message: "Input fitting currently applies to composition references; preprocess standalone assets before adding them." };
        }
        if (ref.adapt && ref.src.startsWith("comp://") && ref.kind !== "audio") {
          const source = this.registry[ref.src.slice("comp://".length)];
          if (!source) return { ok: false, message: `Unknown input composition: ${ref.src.slice("comp://".length)}.` };
          const target = genNativeDims(next);
          const geometry = classifyVisualGeometry(source.width, source.height, target.width, target.height);
          if (!geometry.allowedFits.includes(ref.adapt.fit)) {
            return {
              ok: false,
              message: `${ref.adapt.fit} is not valid for ${source.id}: ${geometry.label.toLowerCase()}.`,
            };
          }
          if (
            ref.adapt.fit === "cover" &&
            ref.adapt.crop &&
            !cropRegionMatchesTargetAspect(ref.adapt.crop, source.width, source.height, target.width, target.height)
          ) {
            return { ok: false, message: `The crop region for ${source.id} must match the model input aspect ratio.` };
          }
        }
        accepted.push(ref);
      }
    }
    const rewritten = recipe.dataFile
      ? { text: `${JSON.stringify(genRecipeDataOf(next), null, 2)}\n` }
      : rewriteRecipeSource(source, next);
    if (!rewritten) return { ok: false, message: `Could not rewrite ${file}.` };
    const committed = await this.commitSourceText("Edit generative recipe", revision, rewritten.text);
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not rewrite ${file}.` };
    // Recipe edits (pins especially) must reach GenOutputs that are already mounted in a
    // playing preview — without this they keep the media they resolved at mount time.
    refreshGenOutputs();
    const dropped = remapped.droppedRefs.length
      ? ` Dropped unsupported inputs: ${remapped.droppedRefs.join(", ")}.`
      : "";
    return { ok: true, message: `Updated ${Object.keys(patch).join(", ")} in ${file}.${dropped}`, receipt: committed.receipt };
  }

  public async pinGenerationTake(compositionKey: string, take: number): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const candidate = (await this.project.getGenerationJobs(recipe.id))?.takes.find((item) => item.generator.take === take);
    if (!candidate) return { ok: false, message: `Take ${take} is unavailable.` };
    const outputKind = candidate.generator.outputKind ??
      (candidate.generator.recipe ? genOutputKindOf({ model: candidate.generator.recipe.model, output: candidate.generator.recipe.output }) : undefined);
    if (outputKind && outputKind !== genOutputKindOf(recipe)) {
      return { ok: false, message: `Take ${take} is ${outputKind}; this composition is locked to ${genOutputKindOf(recipe)}.` };
    }
    return this.updateGenerativeRecipe(compositionKey, { take });
  }

  public async startGenerationFromTake(compositionKey: string, take: number): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const historical = (await this.project.getGenerationJobs(recipe.id))?.takes.find((candidate) => candidate.generator.take === take);
    if (!historical) return { ok: false, message: `Take ${take} is unavailable.` };
    if (genOutputKindOf({ model: historical.generator.recipe?.model, output: historical.generator.recipe?.output }) !== genOutputKindOf(recipe)) {
      return { ok: false, message: `Take ${take} has a different output type and cannot seed this locked composition.` };
    }
    const file = recipe.dataFile ?? recipe.file;
    if (!file) return { ok: false, message: "The recipe does not declare its source file." };
    const revision = await this.project.readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${file}.` };
    const draft = forkGenRecipe(recipe, historical.generator.recipe, historical.generator.inputs);
    const rewritten = recipe.dataFile
      ? { text: `${JSON.stringify(genRecipeDataOf(draft), null, 2)}\n` }
      : rewriteRecipeSource(source, draft);
    if (!rewritten) {
      return { ok: false, message: `Could not start a new take from take ${take} in ${file}.` };
    }
    const committed = await this.commitSourceText(`Start draft from take ${take}`, revision, rewritten.text);
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not start a new take from take ${take} in ${file}.` };
    return { ok: true, message: `Started a new take draft from take ${take}. Tweak it, then generate.`, receipt: committed.receipt };
  }

  public async startGenerationFromJob(compositionKey: string, jobId: string): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const historical = (await this.project.getGenerationJobs(recipe.id))?.jobs.find((candidate) => candidate.id === jobId);
    if (!historical || historical.status !== "failed" || !historical.recipe) {
      return { ok: false, message: "That failed generation attempt is unavailable." };
    }
    if (genOutputKindOf(historical.recipe) !== genOutputKindOf(recipe)) {
      return { ok: false, message: "That failed attempt has a different output type and cannot seed this locked composition." };
    }
    const file = recipe.dataFile ?? recipe.file;
    if (!file) return { ok: false, message: "The recipe does not declare its source file." };
    const revision = await this.project.readSourceRevision(file);
    const source = revision?.text;
    if (!revision || source == null) return { ok: false, message: `Could not read ${file}.` };
    const draft = forkGenRecipe(recipe, historical.recipe, historical.inputs);
    const rewritten = recipe.dataFile
      ? { text: `${JSON.stringify(genRecipeDataOf(draft), null, 2)}\n` }
      : rewriteRecipeSource(source, draft);
    if (!rewritten) {
      return { ok: false, message: `Could not start a new take from failed take ${historical.take ?? "?"} in ${file}.` };
    }
    const label = `Start draft from failed take ${historical.take ?? "?"}`;
    const committed = await this.commitSourceText(label, revision, rewritten.text);
    if (!committed.ok) return { ok: false, message: committed.message ?? `Could not write ${file}.` };
    return {
      ok: true,
      message: `Started a new take draft from failed take ${historical.take ?? "?"}. Tweak it, then generate.`,
      receipt: committed.receipt,
    };
  }

  public async submitGeneration(compositionKey: string): Promise<ProjectOperationResult> {
    const composition = this.registry[compositionKey];
    if (!composition || !("recipe" in composition)) return { ok: false, message: "This is not a generative composition." };
    const recipe = (composition as GenerativeComposition).recipe;
    const definition = genModelOf(recipe);
    const effectiveRecipe = this.voiceAnchoredRecipe(recipe);
    const outputKind = genOutputKindOf(recipe);
    if (definition.output !== outputKind) {
      return {
        ok: false,
        message: `${definition.name} produces ${definition.output}; this composition is locked to ${outputKind}.`,
      };
    }
    if (definition.id === "elevenlabs-direct" && !effectiveRecipe.voice?.trim()) {
      return { ok: false, message: "Set an ElevenLabs voice_id in the recipe before generating." };
    }
    const paramError = genNumericParamValidationError(effectiveRecipe, definition);
    if (paramError) return { ok: false, message: paramError };
    const missingRefs = (definition.requiredRefs ?? []).filter((kind) => !(recipe.refs ?? []).some((ref) => ref.kind === kind));
    if (missingRefs.length) {
      return {
        ok: false,
        message: `${definition.name} requires ${missingRefs.map((kind) => `a ${kind === "endImage" ? "end-frame" : kind} reference`).join(" and ")}.`,
      };
    }
    const accepted: GenRef[] = [];
    for (const ref of recipe.refs ?? []) {
      const decision = genRefAccept({ ...recipe, refs: accepted }, definition, ref.kind);
      if (!decision.ok) return { ok: false, message: decision.why ?? "That input reference is not supported." };
      accepted.push(ref);
    }
    const liveHash = await recipeHashOf(effectiveRecipe);
    const resolved: (GenRef & { mime?: string; name?: string })[] = [];
    const target = genNativeDims(recipe);
    for (const ref of recipe.refs ?? []) {
      if (!ref.src.startsWith("comp://")) {
        if (ref.adapt) {
          return { ok: false, message: "Input fitting currently applies to composition references; preprocess standalone assets before adding them." };
        }
        resolved.push(ref);
      }
      else {
        const inputKey = ref.src.slice(7);
        const inputComp = this.registry[inputKey];
        if (!inputComp) return { ok: false, message: `Unknown input composition: ${inputKey}.` };
        const expectedOutput = ref.kind === "endImage" ? "image" : ref.kind;
        let src: string;
        let mime: string;
        let name: string;
        if ("recipe" in inputComp) {
          const inputRecipe = (inputComp as GenerativeComposition).recipe;
          const inputOutput = genOutputKindOf(inputRecipe);
          if (inputOutput !== expectedOutput) {
            return { ok: false, message: `${inputComp.id} produces ${inputOutput}, not ${expectedOutput}.` };
          }
          const inputData = await this.project.getGenerationJobs(inputRecipe.id);
          const pinned = inputData?.takes.find((take) =>
            take.generator.take === (inputRecipe.take ?? 0) &&
            (take.generator.outputKind == null || take.generator.outputKind === inputOutput)
          );
          if (!pinned) {
            return { ok: false, message: `${inputComp.id} needs a pinned take before it can feed this recipe.` };
          }
          if (inputOutput !== "audio" && inputRecipe.desiredOutput) {
            const baked = await this.bakeComposition(inputKey, () => undefined, inputOutput);
            src = this.project.cacheUrl(baked.filename);
            mime = inputOutput === "image" ? "image/png" : "video/mp4";
            name = `${inputComp.id}.${inputOutput === "image" ? "png" : "mp4"}`;
          } else {
            const extension = inputOutput === "video" ? "mp4" : inputOutput === "audio" ? "mp3" : "jpg";
            src = this.project.cacheUrl(pinned.contentHash);
            mime = pinned.mime ?? (inputOutput === "video" ? "video/mp4" : inputOutput === "audio" ? "audio/mpeg" : "image/jpeg");
            name = `${inputComp.id}.${extension}`;
          }
        } else {
          const inputOutput = inputComp.meta?.output ?? "video";
          if (inputOutput !== expectedOutput) {
            return { ok: false, message: `${inputComp.id} produces ${inputOutput}, not ${expectedOutput}.` };
          }
          if (ref.kind === "audio") {
            return { ok: false, message: `${inputComp.id} is not a pinnable audio generative composition; use an audio asset instead.` };
          }
          const kind: CompositionOutputKind = ref.kind === "video" ? "video" : "image";
          const baked = await this.bakeComposition(inputKey, () => undefined, kind);
          src = this.project.cacheUrl(baked.filename);
          mime = kind === "image" ? "image/png" : "video/mp4";
          name = `${inputComp.id}.${kind === "image" ? "png" : "mp4"}`;
        }
        if (ref.adapt && ref.kind !== "audio") {
          try {
            const adapted = await this.adaptVisualReference({
              id: inputComp.id,
              src,
              kind: ref.kind === "video" ? "video" : "image",
              sourceWidth: inputComp.width,
              sourceHeight: inputComp.height,
              targetWidth: target.width,
              targetHeight: target.height,
              fps: inputComp.fps,
              durationInFrames: inputComp.durationInFrames,
              adaptation: ref.adapt,
            });
            src = this.project.cacheUrl(adapted.contentHash);
            mime = adapted.mime;
            name = adapted.name;
          } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
          }
        }
        resolved.push({
          kind: ref.kind,
          src,
          mime,
          name,
          adapt: ref.adapt,
        });
      }
    }
    const fields = definition.refFieldsOf(recipe);
    // Hash, snapshot, and build provider input from the same effective recipe. This keeps
    // inherited voice-anchor provenance replayable without expanding provider behavior.
    const endpoint = definition.endpointOf(effectiveRecipe);
    const input = definition.buildInput(effectiveRecipe);
    const recipeSnapshot = genRecipeSnapshotOf(effectiveRecipe);
    const snapshotRecipe = { ...recipeSnapshot, id: recipe.id } as GenRecipe;
    const snapshotHash = await recipeHashOf(snapshotRecipe);
    if (
      snapshotHash !== liveHash
      || endpoint !== definition.endpointOf(snapshotRecipe)
      || JSON.stringify(input) !== JSON.stringify(definition.buildInput(snapshotRecipe))
    ) {
      return { ok: false, message: "The submitted generation recipe could not be verified as immutable." };
    }
    const result = await this.project.submitGeneration({
      provider: definition.provider ?? recipe.provider ?? "fal",
      gen: recipe.id,
      endpoint,
      recipeHash: liveHash,
      input,
      refs: resolved.map((ref, index) => ({
        kind: ref.kind,
        src: ref.src,
        authoredSrc: recipe.refs?.[index]?.src ?? ref.src,
        mime: ref.mime,
        name: ref.name,
        adapt: recipe.refs?.[index]?.adapt,
        ...fields.find((field) => field.kind === ref.kind),
      })),
      recipe: recipeSnapshot,
    });
    return result.job && !result.error
      ? { ok: true, message: `Submitted generation ${result.job.id.slice(0, 8)}…` }
      : { ok: false, message: result.error ?? "The generation request was refused." };
  }

  public async configureProvider(provider: string, key: string): Promise<ProjectOperationResult> {
    const saved = await this.project.putSecret(provider, key);
    if (!saved.ok) return { ok: false, message: saved.error ?? `Could not save the ${provider} key.` };
    const verified = await this.project.verifyProvider(provider);
    return verified.ok
      ? { ok: true, message: `${provider} credentials saved.` }
      : { ok: false, message: verified.error ?? `${provider} verification failed.` };
  }

  public async getProviderCredentials(): Promise<ProviderCredentialsSnapshot> {
    const secrets = await this.project.getSecrets();
    if (!secrets) throw new Error("Could not read local service credentials.");
    const providers: ProviderCredentialsSnapshot["providers"] = [
      {
        provider: "fal",
        name: "fal.ai",
        envVar: "FAL_KEY",
        description: "Runs the generative models currently available in FrameDiff.",
        integration: "active",
        ...(secrets.providers.fal ?? { set: false }),
      },
      {
        provider: "byteplus",
        name: "Seedance direct",
        envVar: "ARK_API_KEY",
        description: "Runs Dreamina Seedance 2.0 through ByteDance's official BytePlus ModelArk API. Availability depends on your account region and model activation.",
        integration: "active",
        ...(secrets.providers.byteplus ?? { set: false }),
      },
      {
        provider: "elevenlabs",
        name: "ElevenLabs direct",
        envVar: "ELEVENLABS_API_KEY",
        description: "Runs text-to-speech and Voice Design against ElevenLabs' own API. fal's key does not work here, and going direct unlocks any voice_id — the full library, cloned voices, and designed ones — plus seeded generation.",
        integration: "active",
        ...(secrets.providers.elevenlabs ?? { set: false }),
      },
      {
        provider: "bfl",
        name: "Black Forest Labs direct",
        envVar: "BFL_API_KEY",
        description: "Runs FLUX 3 video against Black Forest Labs' own API. fal's key does not work here — the same model is also wired through fal if you'd rather not add one.",
        integration: "active",
        ...(secrets.providers.bfl ?? { set: false }),
      },
      {
        provider: "midjourney",
        name: "Midjourney",
        envVar: "MIDJOURNEY_API_KEY",
        description: "Store credentials now for a future Midjourney generation adapter.",
        integration: "credentials-only",
        ...(secrets.providers.midjourney ?? { set: false }),
      },
      {
        provider: "luma",
        name: "Luma AI",
        envVar: "LUMAAI_API_KEY",
        description: "Store credentials now for a future Luma generation adapter.",
        integration: "credentials-only",
        ...(secrets.providers.luma ?? { set: false }),
      },
    ];
    return {
      providers,
      storage: secrets.storage ?? {
        title: "Credential storage",
        description: "Secret values are never returned to this UI.",
      },
    };
  }

  public async clearProvider(provider: string): Promise<ProjectOperationResult> {
    const cleared = await this.project.deleteSecret(provider);
    return cleared.ok
      ? { ok: true, message: `${provider} credentials removed.` }
      : { ok: false, message: cleared.error ?? `Could not remove the ${provider} credentials.` };
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
      resolveCompositionOutput: this.resolveCompositionOutput,
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
      resolveCompositionOutput: this.resolveCompositionOutput,
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
    const manifest = await this.project.getAssets();
    if (!manifest) return;
    this.manifest = manifest as AssetManifest;
    this.resolver = createAssetResolver({
      manifest: this.manifest,
      cas: {
        has: async (hash) => (await this.project.readCache(hash)) != null,
        get: (hash) => this.project.readCache(hash),
        put: (hash, blob) => this.project.writeCache(hash, blob),
      },
      trustLocalCacheSources: true,
    });
  }

  private cacheForProbe(): Promise<CacheEntry[]> {
    if (!this.cacheProbe) {
      const current = this.project.listCache();
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
    const fingerprint = await this.getCompositionBakeInputs(compositionKey);
    const hashes = new Map<string, string | null>(Object.entries(fingerprint.inputs));
    for (const input of fingerprint.missing) hashes.set(input, null);
    const current = artifacts.some((entry) => artifactStatusFromInputs(entry.meta?.inputs, hashes) === "current");
    return { artifactStatus: current ? "current" : "stale", ...(take != null ? { pinnedTake: take } : {}) };
  }

  private async loadCompositionSources(compositionKey: string): Promise<FileSet> {
    const paths = compositionSourcePaths(this.registry, compositionKey);
    const entries = await Promise.all(paths.map(async (path) => [path, await this.project.readSource(path)] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] != null));
  }

  private async loadAllSources(): Promise<FileSet> {
    const paths = Object.values(this.registry).flatMap((composition) => [
      composition.meta?.file,
      composition.meta?.module,
      composition.meta?.timelineFile,
      composition.meta?.document?.file,
      ...(composition.meta?.deps ?? []),
      ...(composition.meta?.editableData ?? []).map((source) => source.file),
    ]).filter((path): path is string => !!path);
    const registryFile = await this.findRegistryFile();
    if (registryFile) paths.push(registryFile);
    const entries = await Promise.all([...new Set(paths)].map(async (path) => [path, await this.project.readSource(path)] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] != null));
  }

  private async findRegistryFile(): Promise<string | null> {
    for (const candidate of ["src/config.ts", "src/compositions.ts", "src/main.ts"]) {
      const text = await this.project.readSource(candidate);
      if (text && /\bexport\s+const\s+COMPOSITIONS\b/.test(text)) return candidate;
    }
    return null;
  }
}

export function createStudioRuntime(
  registry: CompRegistry,
  project: StudioProjectAdapter = createHttpStudioProjectAdapter(),
): HtmlStudioRuntime {
  return new HtmlStudioRuntime(registry, project);
}

export {
  createHttpStudioProjectAdapter,
  type GenerationSubmission,
  type StudioProjectAdapter,
} from "../studio/projectAdapter";
