import type { InspectorControlSnapshot, InspectorFieldSnapshot, InspectorOptionSnapshot, TimelineItemSnapshot } from "@framediff/studio-model";
import type { CompositionConfig, CompositionTimelinePlacement } from "../composition";
import type { ColorGradeEffect } from "./types";

export interface HtmlAttributeLocation {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  quote: "\"" | "'" | "";
}

export interface HtmlSourceElement {
  tagName: string;
  start: number;
  startTagEnd: number;
  end: number;
  attributes: Map<string, HtmlAttributeLocation>;
  parent?: HtmlSourceElement;
  children: HtmlSourceElement[];
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function tagEnd(source: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "\"" || char === "'") quote = char;
    else if (char === ">") return index + 1;
  }
  return source.length;
}

function parseAttributes(source: string, start: number, end: number): Map<string, HtmlAttributeLocation> {
  const attributes = new Map<string, HtmlAttributeLocation>();
  let cursor = start + 1;
  while (cursor < end && !/[\s/>]/.test(source[cursor])) cursor += 1;
  while (cursor < end - 1) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] === ">" || source[cursor] === "/") break;
    const nameStart = cursor;
    while (cursor < end && !/[\s=/>]/.test(source[cursor])) cursor += 1;
    const name = source.slice(nameStart, cursor).toLowerCase();
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") {
      attributes.set(name, { name, value: "", valueStart: cursor, valueEnd: cursor, quote: "" });
      continue;
    }
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor] === "\"" || source[cursor] === "'" ? source[cursor] as "\"" | "'" : "";
    if (quote) cursor += 1;
    const valueStart = cursor;
    if (quote) while (cursor < end && source[cursor] !== quote) cursor += 1;
    else while (cursor < end && !/[\s>]/.test(source[cursor])) cursor += 1;
    const valueEnd = cursor;
    attributes.set(name, { name, value: source.slice(valueStart, valueEnd), valueStart, valueEnd, quote });
    if (quote && source[cursor] === quote) cursor += 1;
  }
  return attributes;
}

/** A deliberately small, formatting-preserving HTML scanner for the authored data-fd schema. */
export function parseHtmlSource(source: string): HtmlSourceElement[] {
  const roots: HtmlSourceElement[] = [];
  const stack: HtmlSourceElement[] = [];
  for (let cursor = 0; cursor < source.length;) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    if (source.startsWith("<!--", start)) {
      const close = source.indexOf("-->", start + 4);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    const end = tagEnd(source, start);
    const raw = source.slice(start, end);
    cursor = end;
    if (/^<!|^<\?/.test(raw)) continue;
    const closing = /^<\//.test(raw);
    const name = raw.match(/^<\/?\s*([^\s/>]+)/)?.[1]?.toLowerCase();
    if (!name) continue;
    if (!closing && (name === "script" || name === "style")) {
      const closeStart = source.toLowerCase().indexOf(`</${name}`, end);
      cursor = closeStart < 0 ? source.length : tagEnd(source, closeStart);
      continue;
    }
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const element = stack[index];
        stack.length = index;
        element.end = end;
        if (element.tagName === name) break;
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const element: HtmlSourceElement = {
      tagName: name,
      start,
      startTagEnd: end,
      end,
      attributes: parseAttributes(source, start, end),
      parent,
      children: [],
    };
    if (parent) parent.children.push(element);
    else roots.push(element);
    if (!VOID.has(name) && !/\/\s*>$/.test(raw)) stack.push(element);
  }
  for (const element of stack) element.end = source.length;
  return roots;
}

export function flattenHtmlElements(elements: HtmlSourceElement[]): HtmlSourceElement[] {
  const result: HtmlSourceElement[] = [];
  const visit = (element: HtmlSourceElement) => {
    result.push(element);
    element.children.forEach(visit);
  };
  elements.forEach(visit);
  return result;
}

const value = (element: HtmlSourceElement, name: string): string | undefined => element.attributes.get(name)?.value;
const has = (element: HtmlSourceElement, name: string): boolean => element.attributes.has(name);
const number = (element: HtmlSourceElement, name: string, fallback: number): number => {
  const raw = value(element, name);
  const parsed = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function decodeHtmlText(source: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: "\u00a0", quot: "\"" };
  return source.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== "#") return named[key.toLowerCase()] ?? entity;
    const codePoint = key[1]?.toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}

/** Plain authored text can materialize data-fd-text on its first edit. */
function literalText(source: string, element: HtmlSourceElement): string | undefined {
  if (has(element, "data-fd-text") || value(element, "data-fd-text-authority") === "computed" || element.children.length) return undefined;
  const closeStart = source.toLowerCase().lastIndexOf(`</${element.tagName}`, element.end);
  if (closeStart < element.startTagEnd) return undefined;
  const raw = source.slice(element.startTagEnd, closeStart);
  if (raw.includes("<")) return undefined;
  const text = decodeHtmlText(raw).trim();
  return text || undefined;
}

function isTimelineElement(element: HtmlSourceElement): boolean {
  return has(element, "data-fd-clip")
    || has(element, "data-fd-from")
    || has(element, "data-fd-duration")
    || has(element, "data-fd-type")
    || has(element, "data-fd-comp")
    || element.tagName === "video"
    || element.tagName === "audio"
    || has(element, "data-fd-grade-layer")
    || has(element, "data-fd-grade-video")
    || has(element, "data-fd-video-plane-3d")
    || has(element, "data-fd-camera");
}

function isPlacement(element: HtmlSourceElement): boolean {
  if (has(element, "data-fd-composition")) return false;
  if (has(element, "data-fd-clip") || has(element, "data-fd-from") || has(element, "data-fd-duration")) return true;
  let parent = element.parent;
  while (parent) {
    // The composition root has its own duration metadata, but it is not a placement window.
    if (!has(parent, "data-fd-composition")
      && (has(parent, "data-fd-clip") || has(parent, "data-fd-from") || has(parent, "data-fd-duration"))) return false;
    parent = parent.parent;
  }
  return isTimelineElement(element);
}

function firstContentElement(element: HtmlSourceElement): HtmlSourceElement {
  if (has(element, "data-fd-type") || has(element, "data-fd-comp") || element.tagName === "video" || element.tagName === "audio" || has(element, "data-fd-grade-layer") || has(element, "data-fd-grade-video") || has(element, "data-fd-video-plane-3d") || has(element, "data-fd-camera")) {
    return element;
  }
  return flattenHtmlElements(element.children).find(isTimelineElement) ?? element;
}

const gradeKeys = ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows", "vignette", "bloom", "bloom-threshold"] as const;

function gradeEffect(element: HtmlSourceElement): ColorGradeEffect[] | undefined {
  const grade: Record<string, number> = {};
  for (const key of gradeKeys) {
    const name = `data-fd-grade-${key}`;
    if (has(element, name)) grade[key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = number(element, name, key === "saturation" ? 1 : 0);
  }
  const lut = value(element, "data-fd-lut");
  const lutIntensity = has(element, "data-fd-lut-intensity") ? number(element, "data-fd-lut-intensity", 1) : undefined;
  if (!Object.keys(grade).length && !lut && lutIntensity == null) return undefined;
  return [{
    type: "color-grade",
    grade,
    lut: lut === "gold" ? "gold" : lut ? "custom" : undefined,
    lutIntensity,
    lutName: value(element, "data-fd-lut-name") ?? lut,
  }];
}

function contentOf(element: HtmlSourceElement): TimelineItemSnapshot["content"] {
  const content = firstContentElement(element);
  const type = value(content, "data-fd-type");
  const effects = gradeEffect(content) ?? gradeEffect(element);
  if (type === "nested" || has(content, "data-fd-comp")) {
    return {
      type: "nested",
      compId: value(element, "data-fd-comp") ?? value(content, "data-fd-comp") ?? "",
      trimStart: has(element, "data-fd-trim-start") ? number(element, "data-fd-trim-start", 0) : number(content, "data-fd-trim-start", 0),
      playbackRate: has(element, "data-fd-playback-rate") ? number(element, "data-fd-playback-rate", 1) : number(content, "data-fd-playback-rate", 1),
      effects,
    };
  }
  if (type === "audio" || content.tagName === "audio") {
    return {
      type: "audio",
      src: value(element, "data-fd-src") ?? value(content, "data-fd-src") ?? value(content, "src") ?? "",
      trimStart: has(element, "data-fd-trim-start") ? number(element, "data-fd-trim-start", 0) : number(content, "data-fd-trim-start", 0),
      playbackRate: has(element, "data-fd-playback-rate") ? number(element, "data-fd-playback-rate", 1) : number(content, "data-fd-playback-rate", 1),
    };
  }
  if (type === "video" || content.tagName === "video" || has(content, "data-fd-grade-video") || has(content, "data-fd-video-plane-3d")) {
    return {
      type: "video",
      src: value(element, "data-fd-src") ?? value(content, "data-fd-src") ?? value(content, "src") ?? "",
      trimStart: has(element, "data-fd-trim-start") ? number(element, "data-fd-trim-start", 0) : number(content, "data-fd-trim-start", 0),
      playbackRate: has(element, "data-fd-playback-rate") ? number(element, "data-fd-playback-rate", 1) : number(content, "data-fd-playback-rate", 1),
      effects,
    };
  }
  if (type === "grade" || has(content, "data-fd-grade-layer")) return { type: "grade-layer", effects };
  if (type === "camera" || has(content, "data-fd-camera")) return { type: "camera", camera: value(content, "data-fd-camera") ?? value(content, "data-fd-name") ?? "", effects };
  return { type: "layers", label: value(element, "data-fd-name") ?? value(element, "data-fd-id") ?? "layers", effects };
}

export function timelineFromHtml(composition: CompositionConfig): TimelineItemSnapshot[] {
  const elements = flattenHtmlElements(parseHtmlSource(composition.html)).filter(isPlacement);
  return elements.map((element, order) => {
    const explicitId = value(element, "data-fd-id");
    const content = contentOf(element);
    return {
      id: explicitId ?? `clip:${order}`,
      from: number(element, "data-fd-from", 0),
      durationInFrames: number(element, "data-fd-duration", composition.durationInFrames),
      name: value(element, "data-fd-name"),
      content,
      order,
      ...(has(element, "data-fd-layer") ? { layer: number(element, "data-fd-layer", 0) } : {}),
      origin: has(element, "data-fd-clip") || has(element, "data-fd-from") || has(element, "data-fd-duration") ? "sequence" : "media",
      editable: {
        from: !!explicitId,
        duration: !!explicitId,
        layer: !!explicitId,
        trimStart: !!explicitId && ["nested", "video", "audio"].includes(content.type),
      },
    };
  });
}

function timelineDocumentContent(placement: CompositionTimelinePlacement): TimelineItemSnapshot["content"] | undefined {
  const content = placement.content;
  if (!content) return undefined;
  if (content.type === "nested") {
    return { type: "nested", compId: content.composition, trimStart: placement.trimStart ?? 0, playbackRate: placement.playbackRate ?? 1 };
  }
  if (content.type === "video") return { type: "video", src: content.src, trimStart: placement.trimStart ?? 0, playbackRate: placement.playbackRate ?? 1 };
  if (content.type === "audio") return { type: "audio", src: content.src, trimStart: placement.trimStart ?? 0, playbackRate: placement.playbackRate ?? 1 };
  if (content.type === "camera") return { type: "camera", camera: content.camera };
  if (content.type === "grade-layer") return { type: "grade-layer" };
  return { type: "layers", label: content.label ?? placement.name ?? placement.id };
}

/** Project JSON-authored layers first, with legacy HTML layers retained for compatibility. */
export function timelineFromComposition(composition: CompositionConfig): TimelineItemSnapshot[] {
  const htmlItems = timelineFromHtml(composition);
  if (!composition.timeline) return htmlItems;
  const htmlById = new Map(htmlItems.map((item) => [item.id, item]));
  const projected = composition.timeline.items.map((placement, order) => {
    const html = htmlById.get(placement.id);
    const authoredContent = timelineDocumentContent(placement);
    const fallbackContent: TimelineItemSnapshot["content"] = { type: "layers", label: placement.name ?? placement.id };
    const content = authoredContent ?? (html && ("trimStart" in html.content || "playbackRate" in html.content)
      ? {
          ...html.content,
          ...(placement.trimStart == null ? {} : { trimStart: placement.trimStart }),
          ...(placement.playbackRate == null ? {} : { playbackRate: placement.playbackRate }),
        } as TimelineItemSnapshot["content"]
      : html?.content ?? fallbackContent);
    htmlById.delete(placement.id);
    return {
      ...(html ?? { id: placement.id, order, origin: "sequence" as const }),
      name: placement.name ?? html?.name,
      from: placement.from,
      durationInFrames: Math.max(1, placement.durationInFrames),
      ...(placement.layer == null ? {} : { layer: placement.layer }),
      content,
      order,
      origin: "sequence" as const,
      editable: { from: true, duration: true, layer: true, trimStart: ["nested", "video", "audio"].includes(content.type) },
    } satisfies TimelineItemSnapshot;
  });
  return [...projected, ...htmlItems.filter((item) => htmlById.has(item.id)).map((item, index) => ({ ...item, order: projected.length + index }))];
}

export function findHtmlElementById(source: string, id: string): HtmlSourceElement | undefined {
  return flattenHtmlElements(parseHtmlSource(source)).find((element) => value(element, "data-fd-id") === id);
}

function escapeAttribute(value: string, quote: "\"" | "'"): string {
  return quote === "\"" ? value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;") : value.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

export function rewriteHtmlAttribute(source: string, elementId: string, name: string, next: string | number | boolean): string | null {
  const element = findHtmlElementById(source, elementId);
  if (!element) return null;
  const location = element.attributes.get(name);
  const stringValue = typeof next === "boolean" ? String(next) : String(next);
  if (location) {
    if (!location.quote && location.valueStart === location.valueEnd) {
      return `${source.slice(0, location.valueStart)}=\"${escapeAttribute(stringValue, "\"")}\"${source.slice(location.valueEnd)}`;
    }
    const escaped = location.quote ? escapeAttribute(stringValue, location.quote) : stringValue;
    return `${source.slice(0, location.valueStart)}${escaped}${source.slice(location.valueEnd)}`;
  }
  const insert = element.startTagEnd - (source[element.startTagEnd - 2] === "/" ? 2 : 1);
  return `${source.slice(0, insert)} ${name}=\"${escapeAttribute(stringValue, "\"")}\"${source.slice(insert)}`;
}

/** Rewrite a visual-property patch as one source value so the caller can commit one transaction. */
export function rewriteHtmlAttributes(
  source: string,
  elementId: string,
  patch: Record<string, string | number | boolean>,
): string | null {
  let next = source;
  for (const [name, value] of Object.entries(patch)) {
    const rewritten = rewriteHtmlAttribute(next, elementId, name, value);
    if (rewritten == null) return null;
    next = rewritten;
  }
  return next;
}

export function removeHtmlAttribute(source: string, elementId: string, name: string): string | null {
  const element = findHtmlElementById(source, elementId);
  const location = element?.attributes.get(name);
  if (!element) return null;
  if (!location) return source;
  let start = location.valueStart;
  while (start > element.start && source[start - 1] !== "<" && /\s/.test(source[start - 1])) start -= 1;
  if (location.quote) start -= 1;
  while (start > element.start && source[start - 1] !== "<" && source[start - 1] !== " " && source[start - 1] !== "\n" && source[start - 1] !== "\t") start -= 1;
  let end = location.valueEnd + (location.quote ? 1 : 0);
  return `${source.slice(0, start)}${source.slice(end)}`;
}

/** Add a nested composition as the last layer inside an authored HTML composition. */
export function insertNestedHtmlComposition(
  source: string,
  rootId: string,
  options: { compId: string; name: string; from: number; durationInFrames: number },
): string | null {
  const root = findHtmlElementById(source, rootId);
  if (!root) return null;
  const closeStart = source.toLowerCase().lastIndexOf(`</${root.tagName}`, root.end);
  if (closeStart < root.startTagEnd) return null;

  const ids = new Set(flattenHtmlElements([root]).map((element) => element.attributes.get("data-fd-id")?.value).filter(Boolean));
  const stem = `nested-${options.compId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "composition"}`;
  let id = stem;
  for (let index = 2; ids.has(id); index += 1) id = `${stem}-${index}`;

  const lineStart = source.lastIndexOf("\n", root.start) + 1;
  const rootIndent = (/^[ \t]*/.exec(source.slice(lineStart, root.start)) ?? [""])[0];
  const childIndent = `${rootIndent}  `;
  const block = `<div data-fd-clip data-fd-id="${id}" data-fd-name="${escapeAttribute(options.name, "\"")}" data-fd-from="${Math.round(options.from)}" data-fd-duration="${Math.round(options.durationInFrames)}" data-fd-type="nested" data-fd-comp="${escapeAttribute(options.compId, "\"")}"></div>`;
  const closeLineStart = source.lastIndexOf("\n", closeStart - 1) + 1;
  const closePrefix = source.slice(closeLineStart, closeStart);
  if (/^[ \t]*$/.test(closePrefix)) {
    return `${source.slice(0, closeLineStart)}${childIndent}${block}\n${source.slice(closeLineStart)}`;
  }
  return `${source.slice(0, closeStart)}\n${childIndent}${block}\n${rootIndent}${source.slice(closeStart)}`;
}

type FieldKind = InspectorControlSnapshot["type"];
interface FieldDefinition {
  attribute: string;
  label: string;
  kind: FieldKind;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  slider?: boolean;
  multiline?: boolean;
  options?: InspectorOptionSnapshot[];
  suggestions?: string[];
  accept?: "image" | "video" | "audio" | "any";
  gradientType?: "linear" | "radial";
  labels?: string[];
}

const choices = (...values: string[]): InspectorOptionSnapshot[] => values.map((value) => ({
  value,
  label: value.replaceAll("-", " "),
}));

const STANDARD_FIELDS: FieldDefinition[] = [
  { attribute: "data-fd-x", label: "x", kind: "number", step: 1 },
  { attribute: "data-fd-y", label: "y", kind: "number", step: 1 },
  { attribute: "data-fd-width", label: "width", kind: "number", step: 1 },
  { attribute: "data-fd-height", label: "height", kind: "number", step: 1 },
  { attribute: "data-fd-opacity", label: "opacity", kind: "number", step: 0.01, min: 0, max: 1, slider: true },
  { attribute: "data-fd-scale", label: "scale", kind: "number", step: 0.01 },
  { attribute: "data-fd-rotation", label: "rotation", kind: "number", step: 0.1 },
  { attribute: "data-fd-z-index", label: "z index", kind: "number", step: 1 },
  { attribute: "data-fd-layer", label: "timeline layer", kind: "number", step: 1, min: 0 },
  { attribute: "data-fd-font-size", label: "font size", kind: "number", step: 1 },
  { attribute: "data-fd-line-height", label: "line height", kind: "number", step: 0.01 },
  { attribute: "data-fd-letter-spacing", label: "letter spacing", kind: "number", step: 0.1 },
  { attribute: "data-fd-border-radius", label: "corner radius", kind: "number", step: 1 },
  { attribute: "data-fd-render-width", label: "render width", kind: "number", step: 1 },
  { attribute: "data-fd-render-height", label: "render height", kind: "number", step: 1 },
  { attribute: "data-fd-trim-start", label: "trim start (seconds)", kind: "number", step: 0.01 },
  { attribute: "data-fd-playback-rate", label: "playback rate", kind: "number", step: 0.01 },
  { attribute: "data-fd-nested-scale", label: "nested scale", kind: "number", step: 0.01 },
  { attribute: "data-fd-volume", label: "volume", kind: "number", step: 0.01 },
  { attribute: "data-fd-muted", label: "muted", kind: "boolean" },
  { attribute: "data-fd-text", label: "text", kind: "text", multiline: true },
  { attribute: "data-fd-color", label: "color", kind: "color" },
  { attribute: "data-fd-font-family", label: "font", kind: "font", suggestions: ["Inter", "SF Pro Display", "Helvetica Neue", "Arial", "Georgia", "Courier New", "system-ui", "serif", "sans-serif", "monospace"] },
  { attribute: "data-fd-font-weight", label: "weight", kind: "select", options: choices("300", "400", "500", "600", "700", "800", "900") },
  { attribute: "data-fd-font-style", label: "style", kind: "select", options: choices("normal", "italic", "oblique") },
  { attribute: "data-fd-text-align", label: "align", kind: "alignment", options: choices("left", "center", "right", "justify") },
  { attribute: "data-fd-text-decoration", label: "decoration", kind: "select", options: choices("none", "underline", "line-through", "overline") },
  { attribute: "data-fd-text-transform", label: "case", kind: "select", options: choices("none", "uppercase", "lowercase", "capitalize") },
  { attribute: "data-fd-fill", label: "fill", kind: "select", options: choices("none", "solid", "linear-gradient", "radial-gradient", "image") },
  { attribute: "data-fd-fill-color", label: "fill color", kind: "color" },
  { attribute: "data-fd-gradient-angle", label: "gradient angle", kind: "number", step: 1, min: -360, max: 360, unit: "°", slider: true },
  { attribute: "data-fd-gradient-stops", label: "gradient stops", kind: "gradient", gradientType: "linear" },
  { attribute: "data-fd-image", label: "image", kind: "asset", accept: "image" },
  { attribute: "data-fd-image-position", label: "image position", kind: "alignment", options: choices("center", "top", "right", "bottom", "left") },
  { attribute: "data-fd-layout", label: "layout", kind: "select", options: choices("block", "flex", "grid") },
  { attribute: "data-fd-flex-direction", label: "direction", kind: "select", options: choices("row", "row-reverse", "column", "column-reverse") },
  { attribute: "data-fd-flex-wrap", label: "wrap", kind: "select", options: choices("nowrap", "wrap", "wrap-reverse") },
  { attribute: "data-fd-justify", label: "justify", kind: "select", options: choices("flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly") },
  { attribute: "data-fd-align-items", label: "align items", kind: "select", options: choices("stretch", "flex-start", "center", "flex-end", "baseline") },
  { attribute: "data-fd-align-content", label: "align content", kind: "select", options: choices("normal", "flex-start", "center", "flex-end", "space-between", "space-around", "stretch") },
  { attribute: "data-fd-gap", label: "gap", kind: "number", step: 1, min: 0, unit: "px" },
  { attribute: "data-fd-padding", label: "padding", kind: "vector", labels: ["top", "right", "bottom", "left"], unit: "px" },
  { attribute: "data-fd-blend-mode", label: "blend", kind: "select", options: choices("normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity") },
  { attribute: "data-fd-isolation", label: "isolate", kind: "boolean" },
  { attribute: "data-fd-background", label: "background", kind: "text" },
  { attribute: "data-fd-fit", label: "media fit", kind: "select", options: choices("cover", "contain", "fill", "none", "scale-down") },
  { attribute: "data-fd-src", label: "source", kind: "text" },
  { attribute: "data-fd-comp", label: "composition", kind: "text" },
  ...gradeKeys.map((key) => ({ attribute: `data-fd-grade-${key}`, label: key.replaceAll("-", " "), kind: "number" as const, step: 0.005 })),
  { attribute: "data-fd-lut", label: "LUT", kind: "text" },
  { attribute: "data-fd-lut-name", label: "LUT name", kind: "text" },
  { attribute: "data-fd-lut-intensity", label: "LUT intensity", kind: "number", step: 0.005 },
];

function controlOf(definition: FieldDefinition, raw: string): InspectorControlSnapshot {
  switch (definition.kind) {
    case "number": return { type: "number", value: Number(raw), step: definition.step, min: definition.min, max: definition.max, unit: definition.unit, slider: definition.slider };
    case "boolean": return { type: "boolean", value: raw !== "false" && raw !== "0" };
    case "color": return { type: "color", value: raw };
    case "select": return { type: "select", value: raw, options: definition.options ?? [] };
    case "font": return { type: "font", value: raw, suggestions: definition.suggestions };
    case "asset": return { type: "asset", value: raw, accept: definition.accept };
    case "gradient": return { type: "gradient", value: raw, gradientType: definition.gradientType ?? "linear" };
    case "alignment": return { type: "alignment", value: raw, options: definition.options ?? [] };
    case "vector": return { type: "vector", value: raw, labels: definition.labels ?? [], unit: definition.unit };
    case "text": return { type: "text", value: raw, multiline: definition.multiline };
  }
}

export interface HtmlInspectorField extends InspectorFieldSnapshot {
  attribute: string;
  targetId: string;
}

const INHERITED_FIELDS = new Set([
  "data-fd-src", "data-fd-trim-start", "data-fd-playback-rate", "data-fd-volume", "data-fd-muted", "data-fd-fit",
  "data-fd-render-width", "data-fd-render-height", "data-fd-lut", "data-fd-lut-name", "data-fd-lut-intensity",
  ...gradeKeys.map((key) => `data-fd-grade-${key}`),
]);

const targetFieldId = (itemId: string, targetId: string, attribute: string): string =>
  targetId === itemId ? `html:${attribute}` : `html-target:${encodeURIComponent(targetId)}:${attribute}`;

const targetLabel = (itemId: string, targetId: string, base: string): string =>
  targetId === itemId ? base : `${targetId.replaceAll("-", " ")} · ${base}`;

export function inspectorFieldsFromHtml(source: string, itemId: string): HtmlInspectorField[] {
  const element = findHtmlElementById(source, itemId);
  if (!element) return [];
  const fields: HtmlInspectorField[] = [];
  const candidates = [element, ...flattenHtmlElements(element.children)];
  for (const definition of STANDARD_FIELDS) {
    const matches = candidates.flatMap((candidate) => {
      const location = candidate.attributes.get(definition.attribute);
      if (!location) return [];
      const explicitTarget = value(candidate, "data-fd-id");
      if (candidate !== element && !explicitTarget && !INHERITED_FIELDS.has(definition.attribute)) return [];
      return [{ candidate, location, targetId: explicitTarget ?? itemId }];
    });
    // If the selected clip owns a control, it is the authoritative override for descendants.
    const selected = matches.find((match) => match.candidate === element);
    for (const { location, targetId } of selected ? [selected] : matches) {
      const field: HtmlInspectorField = {
        id: targetFieldId(itemId, targetId, definition.attribute),
        attribute: definition.attribute,
        targetId,
        label: targetLabel(itemId, targetId, definition.label),
        editable: true,
        step: definition.step,
        source: definition.attribute,
        valueType: definition.kind === "number" ? "number" : definition.kind === "boolean" ? "boolean" : "text",
        control: controlOf(definition, location.value),
      };
      if (definition.kind === "number") field.value = Number(location.value);
      else if (definition.kind === "boolean") field.boolean = location.value !== "false" && location.value !== "0";
      else field.text = location.value;
      fields.push(field);
    }
  }
  for (const candidate of candidates) {
    const targetId = value(candidate, "data-fd-id");
    const text = literalText(source, candidate);
    if (!targetId || !text || fields.some((field) => field.attribute === "data-fd-text" && field.targetId === targetId)) continue;
    fields.push({
      id: targetFieldId(itemId, targetId, "data-fd-text"),
      attribute: "data-fd-text",
      targetId,
      label: targetLabel(itemId, targetId, "text"),
      editable: true,
      source: "literal text · materializes data-fd-text on edit",
      valueType: "text",
      text,
      control: { type: "text", value: text, multiline: true },
    });
  }
  for (const candidate of candidates) {
    const explicitTarget = value(candidate, "data-fd-id");
    // Descendant controls need a stable target so Inspector edits cannot
    // accidentally rewrite the selected clip instead.
    if (candidate !== element && !explicitTarget) continue;
    const targetId = explicitTarget ?? itemId;
    for (const [name, location] of candidate.attributes) {
      if (
        !name.startsWith("data-fd-prop-")
        || name.endsWith("-label")
        || name.endsWith("-type")
        || fields.some((field) => field.attribute === name && field.targetId === targetId)
      ) continue;
      const type = value(candidate, `${name}-type`) ?? (Number.isFinite(Number(location.value)) ? "number" : "text");
      const field: HtmlInspectorField = {
        id: targetFieldId(itemId, targetId, name),
        attribute: name,
        targetId,
        label: targetLabel(itemId, targetId, value(candidate, `${name}-label`) ?? name.slice("data-fd-prop-".length).replaceAll("-", " ")),
        editable: true,
        source: name,
        valueType: type === "boolean" ? "boolean" : type === "number" ? "number" : "text",
      };
      field.control = field.valueType === "number"
        ? { type: "number", value: Number(location.value) }
        : field.valueType === "boolean"
          ? { type: "boolean", value: location.value !== "false" && location.value !== "0" }
          : { type: "text", value: location.value };
      if (field.valueType === "number") field.value = Number(location.value);
      else if (field.valueType === "boolean") field.boolean = location.value !== "false" && location.value !== "0";
      else field.text = location.value;
      fields.push(field);
    }
  }
  return fields;
}

export const htmlGradeAttributes = gradeKeys.map((key) => `data-fd-grade-${key}`);

/**
 * Copy a source-backed element (a moodboard card, a cast entry, a script row) into
 * another composition document. The fragment is inserted as the last child of the
 * target's composition root with its data-fd-ids re-uniqued against the target.
 * Returns the rewritten target source and the copied element's new root id.
 */
export function copyHtmlElementInto(
  fromSource: string,
  elementId: string,
  toSource: string,
): { source: string; id: string } | null {
  const element = findHtmlElementById(fromSource, elementId);
  if (!element) return null;
  let fragment = fromSource.slice(element.start, element.end);

  const targetIds = new Set(
    flattenHtmlElements(parseHtmlSource(toSource))
      .map((entry) => entry.attributes.get("data-fd-id")?.value)
      .filter(Boolean),
  );
  const renames = new Map<string, string>();
  for (const entry of flattenHtmlElements([element])) {
    const id = entry.attributes.get("data-fd-id")?.value;
    if (!id || renames.has(id) || !targetIds.has(id)) continue;
    let next = `${id}-2`;
    for (let index = 3; targetIds.has(next); index += 1) next = `${id}-${index}`;
    targetIds.add(next);
    renames.set(id, next);
  }
  for (const [from, to] of renames) {
    fragment = fragment.replaceAll(`data-fd-id="${from}"`, `data-fd-id="${to}"`).replaceAll(`data-fd-id='${from}'`, `data-fd-id='${to}'`);
  }

  const roots = parseHtmlSource(toSource);
  const targetRoot = flattenHtmlElements(roots).find((entry) => entry.attributes.has("data-fd-composition"));
  if (!targetRoot) return null;
  const closeStart = toSource.toLowerCase().lastIndexOf(`</${targetRoot.tagName}`, targetRoot.end);
  if (closeStart < targetRoot.startTagEnd) return null;
  const lineStart = toSource.lastIndexOf("\n", targetRoot.start) + 1;
  const rootIndent = (/^[ \t]*/.exec(toSource.slice(lineStart, targetRoot.start)) ?? [""])[0];
  const source = `${toSource.slice(0, closeStart)}${rootIndent} ${fragment}\n${rootIndent}${toSource.slice(closeStart)}`;
  const rootId = element.attributes.get("data-fd-id")?.value ?? elementId;
  return { source, id: renames.get(rootId) ?? rootId };
}
