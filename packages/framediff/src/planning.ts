// Production planning: plan comps (scripts, rundowns, shot lists) are ordinary HTML
// compositions whose clip rows carry intent. This module gives that intent verbs:
// generate an edit skeleton from a plan, measure plan-vs-master drift, sync actual
// timing back into the plan, and swap a nested slot's comp reference in source.

import { defineComposition, type CompositionConfig } from "./composition";
import {
  flattenHtmlElements,
  parseHtmlSource,
  rewriteHtmlAttribute,
  rewriteHtmlAttributes,
  type HtmlSourceElement,
} from "./studio/htmlSource";

/** Shared production-stage vocabulary rendered consistently across plan rows, hub cards, and timelines. */
export const PLANNING_STATUSES = [
  "board",
  "animatic",
  "blocking",
  "previz",
  "capture",
  "generated",
  "review",
  "final",
] as const;
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];

export interface PlanRow {
  id: string;
  name?: string;
  from: number;
  durationInFrames: number;
  /** data-fd-prop-* attributes verbatim (keys without the prefix, kebab-case). */
  props: Record<string, string>;
}

const value = (element: HtmlSourceElement, name: string): string | undefined =>
  element.attributes.get(name)?.value;
const numberValue = (element: HtmlSourceElement, name: string): number | undefined => {
  const raw = value(element, name);
  if (raw == null || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function planClips(source: string): HtmlSourceElement[] {
  const insideClip = (element: HtmlSourceElement): boolean => {
    for (let parent = element.parent; parent; parent = parent.parent) {
      if (parent.attributes.has("data-fd-clip")) return true;
    }
    return false;
  };
  // Top-level placements only: a reference nested inside a row (a live thumbnail of the
  // comp that realizes it) belongs to the row, it is not a row.
  return flattenHtmlElements(parseHtmlSource(source)).filter(
    (element) => element.attributes.has("data-fd-clip") && value(element, "data-fd-id") && !insideClip(element),
  );
}

/** Read the timed rows of a plan comp (script scenes, rundown segments, shot-list shots). */
export function parsePlanRows(source: string): PlanRow[] {
  return planClips(source).map((element) => {
    const props: Record<string, string> = {};
    for (const [name, location] of element.attributes) {
      if (name.startsWith("data-fd-prop-")) props[name.slice("data-fd-prop-".length)] = location.value;
    }
    return {
      id: value(element, "data-fd-id") as string,
      name: value(element, "data-fd-name"),
      from: numberValue(element, "data-fd-from") ?? 0,
      durationInFrames: numberValue(element, "data-fd-duration") ?? 0,
      props,
    };
  });
}

export interface GenerateEditSkeletonOptions {
  /** Master composition id. Defaults to `<planId>-master`. */
  id?: string;
  /** data-fd-name for the master. Defaults to the plan's name. */
  name?: string;
  /** Registry key each row's slot should nest initially. Defaults to `board-<rowId>`. */
  compFor?: (row: PlanRow) => string;
  /** Initial data-fd-prop-status per slot. Defaults to "animatic". Return undefined to omit. */
  statusFor?: (row: PlanRow) => PlanningStatus | undefined;
  /** Extra data-fd-prop-<matchProp> written on each slot pointing back at the plan row id. Default "plan". */
  matchProp?: string;
  /** data-fd-src values for audio layers (scratch VO, session recording, music bed). */
  audio?: string[];
  /** Grade layer attributes, e.g. { "data-fd-lut-name": "storm-glass" }. */
  gradeLayer?: Record<string, string | number>;
  /** Project-relative data-fd-source for the generated document. */
  file?: string;
}

/**
 * The plan → master transform: every timed plan row becomes a nested placement at the
 * same from/duration. Timing is shared by construction, so the animatic (or recording
 * skeleton, or shot reel) is generated, not assembled.
 */
export function generateEditSkeleton(planSource: string, options: GenerateEditSkeletonOptions = {}): string {
  const plan = defineComposition(planSource);
  const rows = parsePlanRows(planSource);
  const id = options.id ?? `${plan.id}-master`;
  const matchProp = options.matchProp ?? "plan";
  const lines: string[] = [];
  for (const row of rows) {
    const comp = options.compFor?.(row) ?? `board-${row.id}`;
    const status = options.statusFor ? options.statusFor(row) : "animatic";
    lines.push(
      `  <section data-fd-clip data-fd-id="${row.id}"${row.name ? ` data-fd-name="${escapeAttr(row.name)}"` : ""}` +
        ` data-fd-from="${row.from}" data-fd-duration="${row.durationInFrames}"` +
        ` data-fd-type="nested" data-fd-comp="${escapeAttr(comp)}"` +
        ` data-fd-prop-${matchProp}="${escapeAttr(row.id)}"` +
        (status ? ` data-fd-prop-status="${status}"` : "") +
        `></section>`,
    );
  }
  if (options.gradeLayer) {
    const attrs = Object.entries(options.gradeLayer)
      .map(([name, attrValue]) => ` ${name}="${escapeAttr(String(attrValue))}"`)
      .join("");
    lines.push(`  <section data-fd-grade-layer data-fd-id="${id}-look"${attrs}></section>`);
  }
  for (const [index, src] of (options.audio ?? []).entries()) {
    lines.push(`  <audio data-fd-id="${id}-audio-${index + 1}" data-fd-src="${escapeAttr(src)}"></audio>`);
  }
  const name = options.name ?? plan.id;
  return [
    `<!doctype html><html><head><style>`,
    `  [data-fd-composition]{position:relative;overflow:hidden;background:#000}[data-fd-clip]{position:absolute;inset:0}`,
    `</style></head><body>`,
    `<main data-fd-composition data-fd-id="${escapeAttr(id)}" data-fd-name="${escapeAttr(name)}"`,
    `  data-fd-width="${plan.width}" data-fd-height="${plan.height}" data-fd-fps="${plan.fps}"`,
    `  data-fd-duration="${plan.durationInFrames}" data-fd-kind="edit"${options.file ? ` data-fd-source="${escapeAttr(options.file)}"` : ""}>`,
    ...lines,
    `</main>`,
    `</body></html>`,
    ``,
  ].join("\n");
}

function escapeAttr(input: string): string {
  return input.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export interface PlanDriftRow {
  id: string;
  planned: { from: number; durationInFrames: number };
  /** null when the master has no placement matched to this plan row. */
  actual: { from: number; durationInFrames: number } | null;
  /** actual − planned duration; null when unmatched. */
  driftFrames: number | null;
}

export interface PlanDrift {
  rows: PlanDriftRow[];
  /** Master placements matched to no plan row (added during the edit). */
  unplanned: string[];
  totalDriftFrames: number;
}

/**
 * Planned vs actual, per shared id. A master placement matches a plan row when its
 * data-fd-prop-<matchProp> equals the row id, or (fallback) when data-fd-id matches.
 * One timing truth per project: the side that owns time is the caller's choice — this
 * only measures the difference.
 */
export function planDrift(planSource: string, masterSource: string, matchProp = "plan"): PlanDrift {
  const rows = parsePlanRows(planSource);
  const clips = planClips(masterSource);
  const byMatch = new Map<string, HtmlSourceElement>();
  for (const clip of clips) {
    const key = value(clip, `data-fd-prop-${matchProp}`) ?? value(clip, "data-fd-id");
    if (key && !byMatch.has(key)) byMatch.set(key, clip);
  }
  const matched = new Set<HtmlSourceElement>();
  const driftRows: PlanDriftRow[] = rows.map((row) => {
    const clip = byMatch.get(row.id);
    if (!clip) return { id: row.id, planned: { from: row.from, durationInFrames: row.durationInFrames }, actual: null, driftFrames: null };
    matched.add(clip);
    const actual = {
      from: numberValue(clip, "data-fd-from") ?? 0,
      durationInFrames: numberValue(clip, "data-fd-duration") ?? 0,
    };
    return {
      id: row.id,
      planned: { from: row.from, durationInFrames: row.durationInFrames },
      actual,
      driftFrames: actual.durationInFrames - row.durationInFrames,
    };
  });
  const unplanned = clips
    .filter((clip) => !matched.has(clip))
    .map((clip) => value(clip, "data-fd-id") as string);
  return {
    rows: driftRows,
    unplanned,
    totalDriftFrames: driftRows.reduce((sum, row) => sum + (row.driftFrames ?? 0), 0),
  };
}

/**
 * Sync actual timing from a master back into the plan document (the podcast direction:
 * the recording owns the truth, the rundown displays it). Returns rewritten plan source;
 * rows with no matching placement are left untouched.
 */
export function applyPlanActuals(planSource: string, masterSource: string, matchProp = "plan"): string {
  let next = planSource;
  for (const row of planDrift(planSource, masterSource, matchProp).rows) {
    if (!row.actual) continue;
    const rewritten = rewriteHtmlAttributes(next, row.id, {
      "data-fd-from": row.actual.from,
      "data-fd-duration": row.actual.durationInFrames,
    });
    if (rewritten != null) next = rewritten;
  }
  return next;
}

/**
 * Progress is a one-attribute diff: point a slot at its next comp (board → previz →
 * final), optionally advancing its status. Returns null when the slot id is unknown.
 */
export function swapNestedComp(
  source: string,
  clipId: string,
  compId: string,
  status?: PlanningStatus,
): string | null {
  const swapped = rewriteHtmlAttribute(source, clipId, "data-fd-comp", compId);
  if (swapped == null) return null;
  return status ? rewriteHtmlAttribute(swapped, clipId, "data-fd-prop-status", status) ?? swapped : swapped;
}

/** Convenience: the generated skeleton as a ready CompositionConfig. */
export function defineEditSkeleton(planSource: string, options: GenerateEditSkeletonOptions = {}): CompositionConfig {
  return defineComposition(generateEditSkeleton(planSource, options), { meta: { sourceFormat: "generated" } });
}
