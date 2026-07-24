import type { CompositionOutputKind, TimelineItemSnapshot, TimelineLaneSnapshot } from "./types";

function overlaps(a: TimelineItemSnapshot, b: TimelineItemSnapshot): boolean {
  return a.from < b.from + b.durationInFrames && b.from < a.from + a.durationInFrames;
}

/**
 * Presentation-only packing inside one authored layer. Overlapping clips get separate visual
 * subrows; non-overlapping clips reuse a subrow. This never creates or changes stacking authority.
 */
export function packTimelineVisualRows(items: TimelineItemSnapshot[]): TimelineItemSnapshot[][] {
  const stacks: TimelineItemSnapshot[][] = [];
  for (const item of items) {
    const available = stacks.find((stack) => !stack.some((other) => overlaps(item, other)));
    if (available) available.push(item);
    else stacks.push([item]);
  }
  return stacks;
}

function lanesOf(
  items: TimelineItemSnapshot[],
  kind: TimelineLaneSnapshot["kind"],
  prefix: string,
  reverse: boolean,
): TimelineLaneSnapshot[] {
  const explicit = new Map<number, TimelineItemSnapshot[]>();
  const legacy: TimelineItemSnapshot[] = [];
  for (const item of items) {
    if (item.layer == null) legacy.push(item);
    else explicit.set(item.layer, [...(explicit.get(item.layer) ?? []), item]);
  }
  const occupied = new Set(explicit.keys());
  const derived: Array<{ layer: number; items: TimelineItemSnapshot[] }> = [];
  for (const stack of packTimelineVisualRows(legacy)) {
    let layer = 0;
    while (occupied.has(layer)) layer += 1;
    occupied.add(layer);
    derived.push({ layer, items: stack });
  }
  const ranks = [
    ...Array.from(explicit, ([layer, laneItems]) => ({ layer, items: laneItems, authority: "explicit" as const })),
    ...derived.map((lane) => ({ ...lane, authority: "legacy" as const })),
  ].sort((left, right) => reverse ? right.layer - left.layer : left.layer - right.layer);
  return ranks.map(({ layer, items: laneItems, authority }) => ({
    id: `${prefix}:${layer}`,
    label: kind === "grade" ? (ranks.length > 1 ? `GRADE${layer + 1}` : "GRADE") : `${prefix.toUpperCase()}${layer + 1}`,
    kind,
    layer,
    authority,
    items: laneItems,
  }));
}

export function buildTimelineLanes(
  items: TimelineItemSnapshot[],
  nestedOutputKind: (compositionRef: string) => CompositionOutputKind | undefined = () => undefined,
): TimelineLaneSnapshot[] {
  const isAudio = (item: TimelineItemSnapshot) =>
    item.content.type === "audio"
    || (item.content.type === "nested" && nestedOutputKind(item.content.compId) === "audio");
  const grade = items.filter((item) => item.content.type === "grade-layer");
  const audio = items.filter(isAudio);
  const video = items.filter((item) => item.content.type !== "grade-layer" && !isAudio(item));
  return [
    ...lanesOf(grade, "grade", "grade", true),
    ...lanesOf(video, "video", "v", true),
    ...lanesOf(audio, "audio", "a", false),
  ];
}

export interface FrontTrimResult {
  from: number;
  durationInFrames: number;
  trimStart: number;
}

export function artifactStatusFromInputs(
  inputs: Record<string, string> | undefined,
  currentHashes: ReadonlyMap<string, string | null>,
): "current" | "stale" | "untracked" {
  if (!inputs) return "untracked";
  if (Object.keys(inputs).length !== currentHashes.size) return "stale";
  return Object.entries(inputs).every(([file, hash]) => currentHashes.get(file) === hash) ? "current" : "stale";
}

/** Keep the first surviving source sample invariant while moving a clip's front edge. */
export function frontTrimPlacement(
  item: TimelineItemSnapshot,
  newFrom: number,
  compositionFps: number,
): FrontTrimResult {
  const deltaFrames = Math.round(newFrom) - item.from;
  const content = item.content;
  const trimStart = "trimStart" in content ? content.trimStart ?? 0 : 0;
  const playbackRate = "playbackRate" in content ? content.playbackRate ?? 1 : 1;
  return {
    from: Math.round(newFrom),
    durationInFrames: Math.max(1, item.durationInFrames - deltaFrames),
    // Negative trim is intentional pre-roll. Visual sources clamp it to frame one, so extending
    // the edit left holds rather than starting playback early and losing the original alignment.
    trimStart: trimStart + deltaFrames / Math.max(1, compositionFps) * playbackRate,
  };
}

export function timelineItemLabel(item: TimelineItemSnapshot): string {
  if (item.name) return item.name;
  switch (item.content.type) {
    case "nested": return item.content.compId;
    case "video":
    case "image":
    case "audio": return item.content.src.split("/").pop() || item.content.type;
    case "shape": return `${item.content.shape} shape`;
    case "camera": return item.content.camera;
    case "layers": return item.content.label;
    case "grade-layer": return "Color grade";
  }
}
