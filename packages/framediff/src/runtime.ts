import type {
  CompositionConfig,
  CompositionFrameListener,
  CompositionFrameState,
  CompositionOutputKind,
  CompositionRegistry,
  CompositionTimelineContent,
  CompositionTimelineLayout,
} from "./composition";
import type { AssetResolver } from "./assets/resolver";
import { gradeLayerFilter, gradeLayerVignette } from "./effects/gradeLayerCss";
import { isTimelineElementActive } from "./render/activeElement";
import { clampVisualMediaTime } from "./render/mediaTime";
import { jsonPointerValue } from "./studio/jsonDocument";
import { isolateCompositionStyles } from "./styleScope";

type Cleanup = () => void;
type CaptureCanvas = HTMLCanvasElement & {
  __framediffCapture?: (time: number) => Promise<HTMLCanvasElement>;
};

let nextStyleScope = 0;

export interface MountCompositionOptions {
  registry?: CompositionRegistry;
  resolver?: AssetResolver;
  /** Materialize a composition's declared image/audio output for downstream nesting. */
  resolveCompositionOutput?: (compositionRef: string, outputKind: CompositionOutputKind) => Promise<string>;
  frame?: number;
  playing?: boolean;
  gradeBypass?: boolean;
  contentDomain?: { from: number; to: number };
}

export interface CompositionHandle {
  readonly root: HTMLElement;
  readonly ready: Promise<void>;
  update(options: Partial<Pick<CompositionFrameState, "frame" | "playing" | "gradeBypass">>): void;
  updateDocument(document: unknown): void;
  destroy(): void;
}

interface ClipWindow {
  element: HTMLElement;
  from: number;
  duration: number;
  originalDisplay: string;
}

interface NestedMount {
  element: HTMLElement;
  clip: ClipWindow | undefined;
  comp: CompositionConfig;
  handle: CompositionHandle;
  trimStart: number;
  playbackRate: number;
}

const numeric = (element: Element, name: string, fallback: number): number => {
  const raw = element.getAttribute(name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const propertyOwner = (element: Element): Element => {
  const root = element.closest("[data-fd-composition]");
  const owner = element.closest("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  return owner && owner.closest("[data-fd-composition]") === root ? owner : element;
};

/** Effect and media controls edited on a clip intentionally override child-node defaults. */
const inheritedValue = (element: Element, name: string): string | null => {
  const owner = propertyOwner(element);
  return owner !== element && owner.hasAttribute(name) ? owner.getAttribute(name) : element.getAttribute(name);
};

const inheritedNumeric = (element: Element, name: string, fallback: number): number => {
  const raw = inheritedValue(element, name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const inheritedTruthy = (element: Element, name: string, fallback = false): boolean => {
  const raw = inheritedValue(element, name);
  if (raw == null) return fallback;
  return raw !== "false" && raw !== "0";
};

/** Apply a nested placement's gain after its child update, so child frame scripts can author
 *  their own fades first. Each outer nesting level then multiplies the already-effective gain. */
const applyNestedPlacementAudio = (placement: Element, childRoot: HTMLElement): void => {
  const placementVolume = Math.max(0, Math.min(1, numeric(placement, "data-fd-volume", 1)));
  const placementMuted = inheritedTruthy(placement, "data-fd-muted", false);
  for (const media of childRoot.querySelectorAll<HTMLMediaElement>("audio, video")) {
    const localMuted = media.dataset.framediffMuted === "true" || media.muted;
    const exported = Number(media.dataset.framediffVolume ?? media.volume);
    const exportVolume = Number.isFinite(exported) ? Math.max(0, Math.min(1, exported * placementVolume)) : 0;
    media.dataset.framediffVolume = String(localMuted || placementMuted ? 0 : exportVolume);
    media.dataset.framediffMuted = String(localMuted || placementMuted);
    media.muted = localMuted || placementMuted;
    media.volume = Math.max(0, Math.min(1, media.volume * placementVolume));
  }
};

function parseDocument(source: string): { root: HTMLElement; scripts: string[] } {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(source, "text/html");
  const root = documentNode.querySelector<HTMLElement>("[data-fd-composition]");
  if (!root) throw new Error("Composition HTML has no data-fd-composition root.");
  const scripts = Array.from(documentNode.querySelectorAll("script:not([src])"), (script) => script.textContent ?? "");
  for (const style of Array.from(documentNode.head.querySelectorAll("style, link[rel=stylesheet]"))) {
    root.prepend(style.cloneNode(true));
  }
  documentNode.querySelectorAll("script").forEach((script) => script.remove());
  return { root, scripts };
}

function clipWindow(element: HTMLElement, comp: CompositionConfig): ClipWindow | undefined {
  if (element.hasAttribute("data-fd-composition")) return undefined;
  if (!element.hasAttribute("data-fd-clip") && !element.hasAttribute("data-fd-from") && !element.hasAttribute("data-fd-duration")) {
    return undefined;
  }
  return {
    element,
    from: numeric(element, "data-fd-from", 0),
    duration: numeric(element, "data-fd-duration", comp.durationInFrames),
    originalDisplay: element.style.display,
  };
}

function allElements(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
}

function renderTimelineShape(element: HTMLElement, content: Extract<CompositionTimelineContent, { type: "shape" }>): void {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display:block;width:100%;height:100%;overflow:visible;";
  const node = document.createElementNS(ns, content.shape === "rect" ? "rect" : content.shape);
  if (content.shape === "rect") {
    node.setAttribute("x", "1");
    node.setAttribute("y", "1");
    node.setAttribute("width", "98");
    node.setAttribute("height", "98");
  } else if (content.shape === "ellipse") {
    node.setAttribute("cx", "50");
    node.setAttribute("cy", "50");
    node.setAttribute("rx", "49");
    node.setAttribute("ry", "49");
  } else if (content.shape === "line") {
    node.setAttribute("x1", "2");
    node.setAttribute("y1", "50");
    node.setAttribute("x2", "98");
    node.setAttribute("y2", "50");
  } else if (content.shape === "polygon") {
    node.setAttribute("points", content.points ?? "50,2 98,50 50,98 2,50");
  } else {
    node.setAttribute("d", content.d ?? "M 8 50 C 22 8 78 8 92 50 C 78 92 22 92 8 50 Z");
  }
  node.setAttribute("fill", content.shape === "line" ? "none" : content.fill ?? "#f0b969");
  node.setAttribute("stroke", content.stroke ?? (content.shape === "line" ? "#f0b969" : "none"));
  node.setAttribute("stroke-width", String(content.strokeWidth ?? (content.shape === "line" ? 6 : 0)));
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(node);
  element.replaceChildren(svg);
}

function applyTimelineLayout(element: HTMLElement, layout: CompositionTimelineLayout): void {
  const [x, y, width, height] = layout.rect;
  element.setAttribute("data-fd-layout-space", "composition");
  element.setAttribute("data-fd-x", String(x));
  element.setAttribute("data-fd-y", String(y));
  element.setAttribute("data-fd-width", String(width));
  element.setAttribute("data-fd-height", String(height));
  element.setAttribute("data-fd-fit", layout.fit ?? "cover");
  const focalPoint = layout.focalPoint ?? [0.5, 0.5];
  element.setAttribute("data-fd-image-position", `${focalPoint[0] * 100}% ${focalPoint[1] * 100}%`);
  if (layout.cornerRadius == null) element.removeAttribute("data-fd-border-radius");
  else element.setAttribute("data-fd-border-radius", String(layout.cornerRadius));
  if (layout.opacity == null) element.removeAttribute("data-fd-opacity");
  else element.setAttribute("data-fd-opacity", String(layout.opacity));
  // A materialized JSON rectangle is absolute in composition coordinates. Reset legacy inset
  // rules so the timeline document, rather than a CSS selector, owns the placement.
  element.style.position = "absolute";
  element.style.inset = "auto";
  element.style.left = "0";
  element.style.top = "0";
  element.style.right = "auto";
  element.style.bottom = "auto";
  element.style.overflow = "hidden";
}

function applyTimelineDocument(
  root: HTMLElement,
  composition: CompositionConfig,
  registry: CompositionRegistry,
  materializeOutputs: boolean,
): void {
  if (!composition.timeline) return;
  const placementById = new Map(composition.timeline.items.map((item) => [item.id, item]));
  for (const placement of composition.timeline.items) {
    const outputComposition = placement.content?.type === "nested"
      ? resolveNested(registry, placement.content.composition)
      : undefined;
    const outputKind = materializeOutputs ? outputComposition?.meta?.output : undefined;
    let element = Array.from(root.querySelectorAll<HTMLElement>("[data-fd-id]"))
      .find((candidate) => candidate.dataset.fdId === placement.id);
    if (outputKind === "audio" && element && !(element instanceof HTMLAudioElement)) {
      const replacement = document.createElement("audio");
      replacement.setAttribute("data-fd-clip", "");
      replacement.setAttribute("data-fd-id", placement.id);
      element.replaceWith(replacement);
      element = replacement;
    }
    if (!element && placement.content) {
      element = document.createElement(
        outputKind === "audio" || placement.content.type === "audio"
          ? "audio"
          : placement.content.type === "video"
            ? "video"
            : "div",
      );
      element.setAttribute("data-fd-clip", "");
      element.setAttribute("data-fd-id", placement.id);
      element.style.cssText = "position:absolute;inset:0;overflow:hidden;";
      root.appendChild(element);
    }
    if (!element) continue;
    const isAudioPlacement = outputKind === "audio"
      || placement.content?.type === "audio"
      || element.matches("audio,[data-fd-type='audio']");
    if (isAudioPlacement) element.removeAttribute("data-fd-layout-owner");
    else element.setAttribute("data-fd-layout-owner", "timeline");
    if (placement.name) element.setAttribute("data-fd-name", placement.name);
    if (!placement.content) continue;
    element.setAttribute("data-fd-type", placement.content.type);
    if (placement.content.type === "nested") {
      element.setAttribute("data-fd-comp", placement.content.composition);
      if (placement.content.nestedScale != null) element.setAttribute("data-fd-nested-scale", String(placement.content.nestedScale));
      if (outputKind === "audio" || outputKind === "image") {
        element.replaceChildren();
        element.setAttribute("data-fd-output-kind", outputKind);
        const outputRef = `comp://${placement.content.composition}`;
        if (outputKind === "audio") {
          element.setAttribute("data-fd-type", "audio");
          element.setAttribute("data-fd-src", outputRef);
          element.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
        } else {
          element.setAttribute("data-fd-type", "image");
          element.setAttribute("data-fd-image", outputRef);
        }
      } else {
        element.removeAttribute("data-fd-output-kind");
      }
    } else if (placement.content.type === "video" || placement.content.type === "audio") {
      element.setAttribute("data-fd-src", placement.content.src);
    } else if (placement.content.type === "image") {
      element.setAttribute("data-fd-image", placement.content.src);
    } else if (placement.content.type === "shape") {
      element.setAttribute("data-fd-shape", placement.content.shape);
      renderTimelineShape(element, placement.content);
    } else if (placement.content.type === "camera") element.setAttribute("data-fd-camera", placement.content.camera);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-fd-id]")) {
    const placement = placementById.get(element.dataset.fdId ?? "");
    if (!placement) continue;
    element.setAttribute("data-fd-from", String(placement.from));
    element.setAttribute("data-fd-duration", String(Math.max(1, placement.durationInFrames)));
    if (placement.layer == null) element.removeAttribute("data-fd-layer");
    else {
      element.setAttribute("data-fd-layer", String(placement.layer));
      element.removeAttribute("data-fd-z-index");
    }
    if (placement.trimStart == null) element.removeAttribute("data-fd-trim-start");
    else element.setAttribute("data-fd-trim-start", String(placement.trimStart));
    if (placement.playbackRate == null) element.removeAttribute("data-fd-playback-rate");
    else element.setAttribute("data-fd-playback-rate", String(placement.playbackRate));
    if (placement.volume == null) element.removeAttribute("data-fd-volume");
    else element.setAttribute("data-fd-volume", String(Math.max(0, Math.min(1, placement.volume))));
    if (placement.muted == null) element.removeAttribute("data-fd-muted");
    else element.setAttribute("data-fd-muted", String(placement.muted));
    const outputKind = element.getAttribute("data-fd-output-kind");
    if (placement.layout && outputKind !== "audio") applyTimelineLayout(element, placement.layout);
    else {
      element.removeAttribute("data-fd-layout-space");
      element.removeAttribute("data-fd-layout-local-x");
      element.removeAttribute("data-fd-layout-local-y");
    }
  }
}

function resolveNested(registry: CompositionRegistry, value: string): CompositionConfig | undefined {
  return registry[value] ?? Object.values(registry).find((candidate) => candidate.id === value);
}

function applyNestedOutputBindings(
  root: HTMLElement,
  registry: CompositionRegistry,
  materializeOutputs: boolean,
): void {
  if (!materializeOutputs) return;
  for (const authored of Array.from(root.querySelectorAll<HTMLElement>("[data-fd-comp]"))) {
    if (authored.hasAttribute("data-fd-output-kind")) continue;
    const compositionRef = authored.getAttribute("data-fd-comp") ?? "";
    const outputKind = resolveNested(registry, compositionRef)?.meta?.output;
    if (outputKind !== "audio" && outputKind !== "image") continue;
    let element = authored;
    if (outputKind === "audio" && !(element instanceof HTMLAudioElement)) {
      const replacement = document.createElement("audio");
      for (const attribute of Array.from(element.attributes)) {
        if (
          attribute.name === "data-fd-clip"
          || attribute.name === "data-fd-id"
          || attribute.name === "data-fd-name"
          || attribute.name === "data-fd-comp"
          || attribute.name === "data-fd-from"
          || attribute.name === "data-fd-duration"
          || attribute.name === "data-fd-layer"
          || attribute.name === "data-fd-trim-start"
          || attribute.name === "data-fd-playback-rate"
          || attribute.name === "data-fd-volume"
          || attribute.name === "data-fd-muted"
        ) replacement.setAttribute(attribute.name, attribute.value);
      }
      element.replaceWith(replacement);
      element = replacement;
    }
    element.replaceChildren();
    element.setAttribute("data-fd-output-kind", outputKind);
    element.setAttribute("data-fd-type", outputKind);
    if (outputKind === "audio") {
      element.setAttribute("data-fd-src", `comp://${compositionRef}`);
      element.removeAttribute("data-fd-layout-owner");
      element.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
    } else {
      element.setAttribute("data-fd-image", `comp://${compositionRef}`);
    }
  }
}

function localFrameAt(element: Element, frame: number, clips: Map<HTMLElement, ClipWindow>): { frame: number; active: boolean } {
  const ancestors: HTMLElement[] = [];
  let cursor: Element | null = element;
  while (cursor instanceof HTMLElement) {
    if (clips.has(cursor)) ancestors.push(cursor);
    cursor = cursor.parentElement;
  }
  let local = frame;
  let active = true;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const clip = clips.get(ancestors[index])!;
    if (local < clip.from || local >= clip.from + clip.duration) active = false;
    local -= clip.from;
  }
  return { frame: local, active };
}

function applyEditableProperties(element: HTMLElement): void {
  const x = numeric(element, "data-fd-layout-local-x", numeric(element, "data-fd-x", 0));
  const y = numeric(element, "data-fd-layout-local-y", numeric(element, "data-fd-y", 0));
  const scale = numeric(element, "data-fd-scale", 1);
  const rotation = numeric(element, "data-fd-rotation", 0);
  if (["data-fd-x", "data-fd-y", "data-fd-scale", "data-fd-rotation"].some((name) => element.hasAttribute(name))) {
    element.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
  }
  const styles: [string, string, string][] = [
    ["data-fd-width", "width", "px"],
    ["data-fd-height", "height", "px"],
    ["data-fd-opacity", "opacity", ""],
    ["data-fd-z-index", "zIndex", ""],
    ["data-fd-font-size", "fontSize", "px"],
    ["data-fd-line-height", "lineHeight", ""],
    ["data-fd-letter-spacing", "letterSpacing", "px"],
    ["data-fd-border-radius", "borderRadius", "px"],
  ];
  for (const [attribute, property, unit] of styles) {
    if (!element.hasAttribute(attribute)) continue;
    element.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), `${numeric(element, attribute, 0)}${unit}`);
  }
  if (element.hasAttribute("data-fd-layer")) element.style.zIndex = String(Math.round(numeric(element, "data-fd-layer", 0)));
  if (element.hasAttribute("data-fd-color")) element.style.color = element.getAttribute("data-fd-color")!;
  if (element.hasAttribute("data-fd-background")) element.style.background = element.getAttribute("data-fd-background")!;
  if (element.hasAttribute("data-fd-fit")) element.style.objectFit = element.getAttribute("data-fd-fit")!;
  if (element.hasAttribute("data-fd-image-position")) element.style.objectPosition = element.getAttribute("data-fd-image-position")!;
  // data-fd-text is for text leaves; applying it to a container would replace (and
  // silently destroy) every child element, so a stray attribute must never do that.
  if (element.hasAttribute("data-fd-text") && !element.childElementCount) {
    element.textContent = element.getAttribute("data-fd-text") ?? "";
  }
  const directStyles: [string, keyof CSSStyleDeclaration][] = [
    ["data-fd-font-family", "fontFamily"],
    ["data-fd-font-weight", "fontWeight"],
    ["data-fd-font-style", "fontStyle"],
    ["data-fd-text-align", "textAlign"],
    ["data-fd-text-decoration", "textDecoration"],
    ["data-fd-text-transform", "textTransform"],
    ["data-fd-layout", "display"],
    ["data-fd-flex-direction", "flexDirection"],
    ["data-fd-flex-wrap", "flexWrap"],
    ["data-fd-justify", "justifyContent"],
    ["data-fd-align-items", "alignItems"],
    ["data-fd-align-content", "alignContent"],
    ["data-fd-blend-mode", "mixBlendMode"],
    ["data-fd-image-position", "backgroundPosition"],
  ];
  for (const [attribute, property] of directStyles) {
    if (element.hasAttribute(attribute)) (element.style[property] as string) = element.getAttribute(attribute) ?? "";
  }
  if (element.hasAttribute("data-fd-gap")) element.style.gap = `${numeric(element, "data-fd-gap", 0)}px`;
  if (element.hasAttribute("data-fd-padding")) {
    element.style.padding = (element.getAttribute("data-fd-padding") ?? "")
      .trim().split(/[ ,]+/).filter(Boolean).map((part) => /^-?\d+(\.\d+)?$/.test(part) ? `${part}px` : part).join(" ");
  }
  if (element.hasAttribute("data-fd-isolation")) element.style.isolation = inheritedTruthy(element, "data-fd-isolation") ? "isolate" : "auto";
  const fill = element.getAttribute("data-fd-fill");
  const fillColor = element.getAttribute("data-fd-fill-color") ?? "transparent";
  if (fill === "none") {
    element.style.backgroundColor = "transparent";
    element.style.backgroundImage = "none";
  } else if (fill === "solid") {
    element.style.backgroundColor = fillColor;
    element.style.backgroundImage = "none";
  } else if (fill === "linear-gradient" || fill === "radial-gradient") {
    const stops = (element.getAttribute("data-fd-gradient-stops") ?? "#000000@0|#ffffff@1")
      .split("|")
      .map((stop) => {
        const [color, position] = stop.split("@");
        const numericPosition = Number(position);
        return `${color} ${Number.isFinite(numericPosition) ? `${numericPosition * 100}%` : position ?? ""}`.trim();
      })
      .join(", ");
    const angle = numeric(element, "data-fd-gradient-angle", 0);
    element.style.backgroundImage = fill === "linear-gradient"
      ? `linear-gradient(${angle}deg, ${stops})`
      : `radial-gradient(circle, ${stops})`;
  }
  if (fill === "image") {
    const fit = element.getAttribute("data-fd-fit") ?? "cover";
    element.style.backgroundSize = fit === "fill" ? "100% 100%" : fit;
    element.style.backgroundRepeat = "no-repeat";
  }
  if (element.hasAttribute("data-fd-image")) {
    const fit = element.getAttribute("data-fd-fit") ?? "cover";
    element.style.backgroundSize = fit === "fill" ? "100% 100%" : fit;
    element.style.backgroundRepeat = "no-repeat";
  }
}

function applyTimelineLocalCoordinates(root: HTMLElement): void {
  const rootBounds = root.getBoundingClientRect();
  const scaleX = root.offsetWidth ? rootBounds.width / root.offsetWidth : 1;
  const scaleY = root.offsetHeight ? rootBounds.height / root.offsetHeight : 1;
  for (const element of root.querySelectorAll<HTMLElement>('[data-fd-layout-space="composition"][data-fd-x][data-fd-y]')) {
    const offsetParent = element.offsetParent instanceof HTMLElement ? element.offsetParent : root;
    const parentBounds = offsetParent.getBoundingClientRect();
    const parentX = offsetParent === root ? 0 : (parentBounds.left - rootBounds.left) / Math.max(0.0001, scaleX);
    const parentY = offsetParent === root ? 0 : (parentBounds.top - rootBounds.top) / Math.max(0.0001, scaleY);
    element.setAttribute("data-fd-layout-local-x", String(numeric(element, "data-fd-x", 0) - parentX));
    element.setAttribute("data-fd-layout-local-y", String(numeric(element, "data-fd-y", 0) - parentY));
  }
}

function focalPointOf(element: Element): [number, number] {
  const parts = (element.getAttribute("data-fd-image-position") ?? "50% 50%").trim().split(/\s+/);
  const normalized = (part: string | undefined): number => {
    const value = Number((part ?? "50%").replace("%", ""));
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0.5;
  };
  return [normalized(parts[0]), normalized(parts[1] ?? parts[0])];
}

const DOCUMENT_PROPERTY_ATTRIBUTES: Record<string, string> = {
  x: "data-fd-x",
  y: "data-fd-y",
  width: "data-fd-width",
  height: "data-fd-height",
  rotation: "data-fd-rotation",
  scale: "data-fd-scale",
  opacity: "data-fd-opacity",
  zIndex: "data-fd-z-index",
  borderRadius: "data-fd-border-radius",
  text: "data-fd-text",
  color: "data-fd-color",
  background: "data-fd-background",
  fontFamily: "data-fd-font-family",
  fontWeight: "data-fd-font-weight",
  fontStyle: "data-fd-font-style",
  fontSize: "data-fd-font-size",
  lineHeight: "data-fd-line-height",
  letterSpacing: "data-fd-letter-spacing",
  textAlign: "data-fd-text-align",
  textDecoration: "data-fd-text-decoration",
  textTransform: "data-fd-text-transform",
  layout: "data-fd-layout",
  flexDirection: "data-fd-flex-direction",
  flexWrap: "data-fd-flex-wrap",
  justify: "data-fd-justify",
  alignItems: "data-fd-align-items",
  alignContent: "data-fd-align-content",
  gap: "data-fd-gap",
  padding: "data-fd-padding",
  blendMode: "data-fd-blend-mode",
  isolation: "data-fd-isolation",
  fill: "data-fd-fill",
  fillColor: "data-fd-fill-color",
  gradientAngle: "data-fd-gradient-angle",
  gradientStops: "data-fd-gradient-stops",
  image: "data-fd-image",
  fit: "data-fd-fit",
  imagePosition: "data-fd-image-position",
  src: "data-fd-src",
  volume: "data-fd-volume",
  muted: "data-fd-muted",
  gradeExposure: "data-fd-grade-exposure",
  gradeContrast: "data-fd-grade-contrast",
  gradeSaturation: "data-fd-grade-saturation",
  gradeTemperature: "data-fd-grade-temperature",
  gradeTint: "data-fd-grade-tint",
  gradeHighlights: "data-fd-grade-highlights",
  gradeShadows: "data-fd-grade-shadows",
  gradeVignette: "data-fd-grade-vignette",
  gradeBloom: "data-fd-grade-bloom",
  gradeBloomThreshold: "data-fd-grade-bloom-threshold",
  lut: "data-fd-lut",
  lutKey: "data-fd-lut-key",
  lutName: "data-fd-lut-name",
  lutIntensity: "data-fd-lut-intensity",
};

/**
 * A document binding is also the default direct-manipulation adapter. Recognized presentation
 * properties become the same data-fd runtime attributes used by HTML-authored comps, so preview,
 * exact render, Inspector, and canvas gestures all read one JSON value.
 */
function applyCompositionDocument(root: HTMLElement, composition: CompositionConfig, value: unknown): void {
  const bindings = composition.meta?.document?.bindings;
  if (!bindings || value == null || typeof value !== "object") return;
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("[data-fd-id]"))];
  for (const [objectId, pointer] of Object.entries(bindings)) {
    const element = elements.find((candidate) => candidate.dataset.fdId === objectId);
    const properties = jsonPointerValue(value, pointer);
    if (!element || properties == null || typeof properties !== "object" || Array.isArray(properties)) continue;
    for (const [property, attribute] of Object.entries(DOCUMENT_PROPERTY_ATTRIBUTES)) {
      const next = (properties as Record<string, unknown>)[property];
      if (typeof next !== "string" && typeof next !== "number" && typeof next !== "boolean") continue;
      element.setAttribute(attribute, String(next));
    }
    applyEditableProperties(element);
  }
}

function gradeOf(element: HTMLElement) {
  return {
    exposure: numeric(element, "data-fd-grade-exposure", 0),
    contrast: numeric(element, "data-fd-grade-contrast", 0),
    saturation: numeric(element, "data-fd-grade-saturation", 1),
    temperature: numeric(element, "data-fd-grade-temperature", 0),
    tint: numeric(element, "data-fd-grade-tint", 0),
    highlights: numeric(element, "data-fd-grade-highlights", 0),
    shadows: numeric(element, "data-fd-grade-shadows", 0),
    vignette: numeric(element, "data-fd-grade-vignette", 0),
    bloom: numeric(element, "data-fd-grade-bloom", 0),
  };
}

function executeScript(
  source: string,
  root: HTMLElement,
  context: Record<string, unknown>,
): void {
  const names = Object.keys(context);
  const values = Object.values(context);
  // Composition documents are trusted project source, equivalent to importing a local JS module.
  const run = new Function("root", ...names, `"use strict";\n${source}\n//# sourceURL=framediff-composition-inline.js`);
  run(root, ...values);
}

export function mountComposition(
  host: HTMLElement,
  composition: CompositionConfig,
  options: MountCompositionOptions = {},
): CompositionHandle {
  const registry = options.registry ?? {};
  const resolver = options.resolver;
  const abort = new AbortController();
  const cleanups: Cleanup[] = [];
  const frameListeners = new Set<CompositionFrameListener>();
  const documentListeners = new Set<(document: unknown) => void | Promise<void>>();
  let currentDocument = composition.document;
  const nested: NestedMount[] = [];
  const parsed = parseDocument(composition.html);
  const root = parsed.root;
  applyTimelineDocument(root, composition, registry, !!options.resolveCompositionOutput);
  applyNestedOutputBindings(root, registry, !!options.resolveCompositionOutput);
  applyCompositionDocument(root, composition, currentDocument);
  root.style.position ||= "relative";
  root.style.width ||= `${composition.width}px`;
  root.style.height ||= `${composition.height}px`;
  root.style.overflow ||= "hidden";
  root.classList.add("framediff-composition");
  host.replaceChildren(root);
  const styleScope = `fd-${++nextStyleScope}`;
  cleanups.push(isolateCompositionStyles(root, styleScope));
  applyTimelineLocalCoordinates(root);

  const elements = allElements(root);
  const clipMap = new Map<HTMLElement, ClipWindow>();
  for (const element of elements) {
    const clip = clipWindow(element, composition);
    if (clip) clipMap.set(element, clip);
    applyEditableProperties(element);
  }

  const resolveAsset = async (ref: string): Promise<string> => {
    if (ref.startsWith("comp://") && options.resolveCompositionOutput) {
      const compositionRef = ref.slice("comp://".length);
      const outputKind = resolveNested(registry, compositionRef)?.meta?.output;
      if (outputKind === "image" || outputKind === "audio") {
        const resolved = options.resolveCompositionOutput(compositionRef, outputKind);
        // An audio reference without a pinned take plays as silence rather than
        // failing the mount — the placement already surfaces as silent in the UI.
        if (outputKind === "audio") return resolved.catch(() => "");
        return resolved;
      }
    }
    if (!resolver) return ref;
    return (await resolver.resolve(ref)).url;
  };

  const refreshDocumentMedia = async (): Promise<void> => {
    await Promise.all(allElements(root).map(async (element) => {
      if (!(element instanceof HTMLMediaElement)) return;
      const authored = inheritedValue(element, "data-fd-src") ?? element.getAttribute("src") ?? "";
      if (!authored) {
        element.removeAttribute("src");
        return;
      }
      element.setAttribute("data-fd-src", authored);
      const immediate = resolver?.peek(authored)?.url;
      if (immediate) element.src = immediate;
      const url = await resolveAsset(authored);
      if (!abort.signal.aborted && url && element.getAttribute("data-fd-src") === authored) element.src = url;
    }));
  };

  const refreshDocumentImages = async (): Promise<void> => {
    await Promise.all(allElements(root).map(async (element) => {
      if (!element.hasAttribute("data-fd-image")) return;
      const authored = element.getAttribute("data-fd-image") ?? "";
      if (!authored) {
        element.style.backgroundImage = "";
        return;
      }
      const immediate = resolver?.peek(authored)?.url;
      if (immediate) element.style.backgroundImage = `url("${immediate.replaceAll('"', '%22')}")`;
      const url = await resolveAsset(authored);
      if (!abort.signal.aborted && element.getAttribute("data-fd-image") === authored) {
        element.style.backgroundImage = `url("${url.replaceAll('"', '%22')}")`;
      }
    }));
  };

  const mediaReady = Promise.all(elements.flatMap((element) => {
    const tasks: Promise<void>[] = [];
    if (element instanceof HTMLMediaElement) {
      const authored = inheritedValue(element, "data-fd-src") ?? element.getAttribute("src") ?? "";
      if (authored) {
        element.setAttribute("data-fd-src", authored);
        const immediate = resolver?.peek(authored)?.url;
        if (immediate) element.src = immediate;
        tasks.push(resolveAsset(authored).then((url) => { if (!abort.signal.aborted && url) element.src = url; }));
      }
    }
    const image = element.getAttribute("data-fd-image");
    if (image) {
      const immediate = resolver?.peek(image)?.url;
      if (immediate) element.style.backgroundImage = `url("${immediate.replaceAll('"', '%22')}")`;
      tasks.push(resolveAsset(image).then((url) => {
        if (!abort.signal.aborted) element.style.backgroundImage = `url("${url.replaceAll('"', '%22')}")`;
      }));
    }
    return tasks;
  }));

  for (const element of elements) {
    const type = element.getAttribute("data-fd-type");
    const childId = element.getAttribute("data-fd-comp");
    if (element.hasAttribute("data-fd-output-kind")) continue;
    if (type !== "nested" && !childId) continue;
    const child = childId ? resolveNested(registry, childId) : undefined;
    if (!child) {
      element.dataset.fdError = `Unknown nested composition: ${childId ?? ""}`;
      continue;
    }
    const childHost = document.createElement("div");
    childHost.className = "framediff-nested-host";
    childHost.style.cssText = `position:absolute;inset:0;width:${child.width}px;height:${child.height}px;transform-origin:top left;`;
    const explicitScale = numeric(element, "data-fd-nested-scale", NaN);
    const ownsLayout = element.getAttribute("data-fd-layout-space") === "composition"
      && element.hasAttribute("data-fd-width")
      && element.hasAttribute("data-fd-height");
    const boxWidth = ownsLayout ? numeric(element, "data-fd-width", element.offsetWidth) : composition.width;
    const boxHeight = ownsLayout ? numeric(element, "data-fd-height", element.offsetHeight) : composition.height;
    const fit = element.getAttribute("data-fd-fit") ?? "cover";
    const fitX = boxWidth / child.width;
    const fitY = boxHeight / child.height;
    const uniform = fit === "contain" ? Math.min(fitX, fitY) : Math.max(fitX, fitY);
    const sx = Number.isFinite(explicitScale) ? explicitScale : ownsLayout ? fit === "fill" ? fitX : uniform : fitX;
    const sy = Number.isFinite(explicitScale) ? explicitScale : ownsLayout ? fit === "fill" ? fitY : uniform : fitY;
    if (ownsLayout) {
      const [focusX, focusY] = focalPointOf(element);
      childHost.style.inset = "auto";
      childHost.style.left = `${(boxWidth - child.width * sx) * focusX}px`;
      childHost.style.top = `${(boxHeight - child.height * sy) * focusY}px`;
    }
    if (sx !== 1 || sy !== 1) childHost.style.transform = `scale(${sx}, ${sy})`;
    element.appendChild(childHost);
    const handle = mountComposition(childHost, child, {
      registry,
      resolver,
      resolveCompositionOutput: options.resolveCompositionOutput,
      playing: options.playing,
      gradeBypass: options.gradeBypass,
    });
    nested.push({
      element,
      clip: clipMap.get(element),
      comp: child,
      handle,
      trimStart: numeric(element, "data-fd-trim-start", 0),
      playbackRate: numeric(element, "data-fd-playback-rate", 1),
    });
  }

  let state: CompositionFrameState = {
    frame: options.frame ?? 0,
    time: (options.frame ?? 0) / composition.fps,
    playing: options.playing ?? false,
    gradeBypass: options.gradeBypass ?? false,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  };

  const onFrame = (listener: CompositionFrameListener): Cleanup => {
    if (abort.signal.aborted) return () => {};
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  };
  const onDocument = (listener: (document: unknown) => void | Promise<void>): Cleanup => {
    if (abort.signal.aborted) return () => {};
    documentListeners.add(listener);
    return () => documentListeners.delete(listener);
  };
  const onCleanup = (cleanup: Cleanup) => {
    // Async setup may finish after its composition was replaced (for example while the asset
    // manifest is loading). Dispose late resources immediately instead of leaking hidden media,
    // GPU renderers, or capture callbacks into the next mount.
    if (abort.signal.aborted) {
      try { cleanup(); } catch { /* late cleanup should not escape setup */ }
      return;
    }
    cleanups.push(cleanup);
  };

  const setupContext = {
    root,
    composition,
    registry,
    resolver,
    signal: abort.signal,
    document: currentDocument,
    query: <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector),
    queryAll: <T extends Element = HTMLElement>(selector: string) => Array.from(root.querySelectorAll<T>(selector)),
    onFrame,
    onDocument,
    onCleanup,
    resolveAsset,
  };

  const scriptApi = {
    composition,
    document: currentDocument,
    onFrame,
    onDocument,
    onCleanup,
    query: setupContext.query,
    queryAll: setupContext.queryAll,
    resolveAsset,
    interpolate: (value: number, input: [number, number], output: [number, number]) => {
      const t = Math.max(0, Math.min(1, (value - input[0]) / Math.max(Number.EPSILON, input[1] - input[0])));
      return output[0] + (output[1] - output[0]) * t;
    },
  };

  const setupReady = Promise.resolve().then(async () => {
    for (const script of parsed.scripts) executeScript(script, root, scriptApi);
    const cleanup = await composition.setup?.(setupContext);
    if (cleanup) onCleanup(cleanup);
  });

  const update = (next: Partial<Pick<CompositionFrameState, "frame" | "playing" | "gradeBypass">>) => {
    if (abort.signal.aborted) return;
    const frame = next.frame ?? state.frame;
    state = {
      ...state,
      ...next,
      frame,
      time: frame / composition.fps,
    };
    const inDomain = !options.contentDomain || (frame >= options.contentDomain.from && frame < options.contentDomain.to);
    root.style.visibility = inDomain ? "visible" : "hidden";
    root.style.setProperty("--fd-frame", String(frame));
    root.style.setProperty("--fd-time", String(state.time));
    root.dataset.fdFrame = String(frame);
    root.dataset.fdTime = String(state.time);

    // Document-flow comps (plans, docs) keep every timed row visible: rows are prose
    // first and placements second, so the active window is a highlight, not visibility.
    const documentFlow = ["plan", "doc", "script", "locations", "cast", "board"].includes(composition.definition.kind);
    for (const clip of clipMap.values()) {
      const local = localFrameAt(clip.element, frame, clipMap);
      clip.element.style.display = documentFlow || (inDomain && local.active) ? clip.originalDisplay : "none";
      clip.element.dataset.fdActive = String(inDomain && local.active);
      clip.element.dataset.fdLocalFrame = String(local.frame);
      clip.element.style.setProperty("--fd-local-frame", String(local.frame));
      clip.element.style.setProperty("--fd-local-time", String(local.frame / composition.fps));
    }

    for (const element of elements) {
      const local = localFrameAt(element, frame, clipMap);
      const localTime = local.frame / composition.fps;
      if (element instanceof HTMLVideoElement) {
        const trimStart = inheritedNumeric(element, "data-fd-trim-start", 0);
        const rate = inheritedNumeric(element, "data-fd-playback-rate", 1);
        const target = clampVisualMediaTime(
          trimStart + ((local.frame + 0.5) / composition.fps) * rate,
          element.duration,
        );
        element.setAttribute("data-framediff-video", "");
        element.dataset.framediffTime = String(target);
        element.playbackRate = rate;
        const muted = inheritedTruthy(element, "data-fd-muted", element.defaultMuted);
        const volume = Math.max(0, Math.min(1, inheritedNumeric(element, "data-fd-volume", 1)));
        element.dataset.framediffVolume = String(muted ? 0 : volume);
        element.dataset.framediffMuted = String(muted);
        element.muted = muted;
        element.volume = volume;
        const fit = inheritedValue(element, "data-fd-fit");
        if (fit) element.style.objectFit = fit;
        if (local.active && inDomain && state.playing) {
          const holdAtEnd = Number.isFinite(element.duration) && target >= element.duration - 0.05;
          if (holdAtEnd) {
            // An ended video restarts from 0 on play(), which strobes between first and last
            // frames when a placement outlives its source — hold the final frame instead.
            if (!element.paused) element.pause();
            if (Math.abs(element.currentTime - target) > 0.04) { try { element.currentTime = target; } catch { /* media may not be ready */ } }
          } else {
            if (Math.abs(element.currentTime - target) > 0.5) { try { element.currentTime = target; } catch { /* media may not be ready */ } }
            if (element.paused) void element.play().catch(() => {});
          }
        } else {
          if (!element.paused) element.pause();
          if (local.active && inDomain && Math.abs(element.currentTime - target) > 0.04) {
            try { element.currentTime = target; } catch { /* media may not be ready */ }
          }
        }
      } else if (element instanceof HTMLAudioElement) {
        const trimStart = inheritedNumeric(element, "data-fd-trim-start", 0);
        const rate = inheritedNumeric(element, "data-fd-playback-rate", 1);
        const target = trimStart + localTime * rate;
        const muted = inheritedTruthy(element, "data-fd-muted", element.defaultMuted);
        const volume = Math.max(0, Math.min(1, inheritedNumeric(element, "data-fd-volume", 1)));
        element.setAttribute("data-framediff-audio", "");
        element.dataset.framediffTime = String(target);
        element.dataset.framediffVolume = String(muted ? 0 : volume);
        element.dataset.framediffMuted = String(muted);
        element.muted = muted;
        element.volume = volume;
        element.playbackRate = rate;
        const sourceActive = target >= 0 && (!Number.isFinite(element.duration) || target < element.duration);
        if (local.active && inDomain && sourceActive && state.playing) {
          if (Math.abs(element.currentTime - target) > 0.5) { try { element.currentTime = target; } catch { /* media may not be ready */ } }
          if (element.paused) void element.play().catch(() => {});
        } else if (!element.paused) element.pause();
      } else if (element instanceof HTMLCanvasElement && (element.hasAttribute("data-fd-webgpu") || element.hasAttribute("data-framediff-webgpu"))) {
        element.setAttribute("data-framediff-webgpu", "");
        element.dataset.framediffTime = String(localTime);
      }

      if (element.hasAttribute("data-fd-grade-layer")) {
        const grade = gradeOf(element);
        const filter = state.gradeBypass ? "" : gradeLayerFilter(grade);
        element.setAttribute("data-framediff-gradelayer", "");
        element.style.backdropFilter = filter;
        element.style.setProperty("-webkit-backdrop-filter", filter);
        const vignette = state.gradeBypass ? 0 : grade.vignette;
        element.style.backgroundImage = vignette ? gradeLayerVignette(vignette) : "";
      }
    }

    for (const child of nested) {
      const local = localFrameAt(child.element, frame, clipMap);
      const childFrame = Math.max(0, Math.min(
        child.comp.durationInFrames - 1e-6,
        (local.frame / composition.fps * child.playbackRate + child.trimStart) * child.comp.fps,
      ));
      child.handle.update({ frame: childFrame, playing: state.playing && local.active && inDomain, gradeBypass: state.gradeBypass });
      applyNestedPlacementAudio(child.element, child.handle.root);
    }

    // Nested composition trees remain mounted, but a hidden outer clip should not keep driving
    // their scripts/effects. The current frame is still propagated above, so activation resumes at
    // the exact requested frame without replaying intermediate work.
    if (!isTimelineElementActive(root, root)) return;
    root.dispatchEvent(new CustomEvent<CompositionFrameState>("framediff:frame", { detail: state }));
    for (const listener of frameListeners) {
      try {
        const result = listener(state);
        if (result) void result.catch((error) => {
          if (!abort.signal.aborted) console.error("FrameDiff frame listener failed.", error);
        });
      } catch (error) {
        if (!abort.signal.aborted) console.error("FrameDiff frame listener failed.", error);
      }
    }
  };

  const ready = Promise.all([mediaReady, setupReady, ...nested.map((entry) => entry.handle.ready)]).then(() => {
    update(state);
  });
  update(state);

  return {
    root,
    ready,
    update,
    updateDocument(document: unknown) {
      if (abort.signal.aborted) return;
      currentDocument = document;
      applyCompositionDocument(root, composition, document);
      void refreshDocumentImages().catch((error) => {
        if (!abort.signal.aborted) console.error("FrameDiff document image update failed.", error);
      });
      void refreshDocumentMedia().catch((error) => {
        if (!abort.signal.aborted) console.error("FrameDiff document media update failed.", error);
      });
      root.dispatchEvent(new CustomEvent("framediff:document", { detail: document }));
      for (const listener of documentListeners) {
        try {
          const result = listener(document);
          if (result) void result.catch((error) => {
            if (!abort.signal.aborted) console.error("FrameDiff document listener failed.", error);
          });
        } catch (error) {
          if (!abort.signal.aborted) console.error("FrameDiff document listener failed.", error);
        }
      }
    },
    destroy() {
      if (abort.signal.aborted) return;
      abort.abort();
      for (const child of nested) child.handle.destroy();
      for (const cleanup of cleanups.reverse()) {
        try { cleanup(); } catch { /* cleanup should not prevent unmount */ }
      }
      frameListeners.clear();
      documentListeners.clear();
      host.replaceChildren();
    },
  };
}

/** Install the deterministic capture seam on an authored WebGPU/WebGL canvas.
 *  `time` is the canvas's clip-local timeline time in seconds. */
export function registerCanvasCapture(
  canvas: HTMLCanvasElement,
  capture: (time: number) => Promise<HTMLCanvasElement> | HTMLCanvasElement,
): Cleanup {
  const target = canvas as CaptureCanvas;
  canvas.setAttribute("data-fd-webgpu", "");
  canvas.setAttribute("data-framediff-webgpu", "");
  target.__framediffCapture = async (time) => capture(time);
  return () => { delete target.__framediffCapture; };
}
