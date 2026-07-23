// Lane building: pack introspected items into V/A lanes (document order = paint order, later on
// top), append the comp's declared lanes, and derive the cross-comp graph (tree, used-by).

import type { CompRegistry, Lane, OutputItem, StudioComposition, TimelineItem } from "./types";

/** Clamp open-ended windows to the comp and split video vs audio stacks. */
export function buildLanes(
  comp: StudioComposition,
  items: TimelineItem[],
  registry: CompRegistry,
  output: OutputItem[],
): Lane[] {
  const dur = comp.durationInFrames;
  const clamped = items.map((it) => ({
    ...it,
    from: Math.max(0, it.from),
    durationInFrames: Math.min(it.durationInFrames, dur - Math.max(0, it.from)),
  }));

  const isAudio = (it: TimelineItem) => it.content.type === "audio";
  const isGrade = (it: TimelineItem) => it.content.type === "grade-layer";
  const video = clamped.filter((it) => !isAudio(it) && !isGrade(it));
  const audio = clamped.filter(isAudio);
  const grade = clamped.filter(isGrade);

  const lanes: Lane[] = [];
  // Floating grades sit above the video stacks — they grade everything below.
  const gStacks = pack(grade);
  for (let i = gStacks.length - 1; i >= 0; i--) {
    lanes.push({ type: "clips", label: gStacks.length > 1 ? `GRADE${i + 1}` : "GRADE", items: gStacks[i] });
  }
  // Video stacks: pack in document order; an item overlapping an earlier one goes a lane up.
  // Display top-down (Vn..V1), prototype-style.
  const vStacks = pack(video);
  for (let i = vStacks.length - 1; i >= 0; i--) {
    lanes.push({ type: "clips", label: vStacks.length > 1 ? `V${i + 1}` : "V1", items: vStacks[i] });
  }
  const aStacks = pack(audio);
  aStacks.forEach((stack, i) => lanes.push({ type: "clips", label: `A${i + 1}`, items: stack }));

  for (const ln of comp.meta?.lanes ?? []) lanes.push(ln);
  if (output.length) lanes.push({ type: "output", label: "OUTPUT", items: output });
  return lanes;
}

function pack(items: TimelineItem[]): TimelineItem[][] {
  const stacks: TimelineItem[][] = [];
  for (const it of items) {
    let placed = false;
    for (const stack of stacks) {
      if (!stack.some((o) => overlaps(o, it))) {
        stack.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) stacks.push([it]);
  }
  return stacks;
}

function overlaps(a: TimelineItem, b: TimelineItem): boolean {
  return a.from < b.from + b.durationInFrames && b.from < a.from + a.durationInFrames;
}

// ---- cross-comp graph -------------------------------------------------------

export type ItemGraph = Record<string, TimelineItem[]>; // compKey → probed items

/** Resolve timeline nested references written as stable registry keys or legacy comp ids. */
export function keyOfCompId(registry: CompRegistry, compId: string): string | undefined {
  if (registry[compId]) return compId;
  return Object.keys(registry).find((k) => registry[k].id === compId);
}

/** Which comps does `key` reference (its children in the tree)? Deduped, in item order. */
export function childrenOf(key: string, registry: CompRegistry, graph: ItemGraph): string[] {
  const out: string[] = [];
  for (const it of graph[key] ?? []) {
    if (it.content.type !== "nested") continue;
    const childKey = keyOfCompId(registry, it.content.compId);
    if (childKey && !out.includes(childKey)) out.push(childKey);
  }
  return out;
}

export interface UseRef {
  parentKey: string;
  item: TimelineItem;
  /** The window of the CHILD that the parent uses, in child frames. */
  childFrom: number;
  childDuration: number;
}

/** Every place `childKey` is used as a clip, with the child-frame window (for use-bands). */
export function refsTo(childKey: string, registry: CompRegistry, graph: ItemGraph): UseRef[] {
  const child = registry[childKey];
  const out: UseRef[] = [];
  if (!child) return out;
  for (const parentKey of Object.keys(graph)) {
    const parent = registry[parentKey];
    if (!parent || parentKey === childKey) continue;
    for (const it of graph[parentKey]) {
      if (it.content.type !== "nested" || keyOfCompId(registry, it.content.compId) !== childKey) continue;
      const dur = Math.min(it.durationInFrames, parent.durationInFrames - it.from);
      const childFrom = it.content.trimStart * child.fps;
      const childDuration = Math.min((dur / parent.fps) * child.fps, child.durationInFrames - childFrom);
      out.push({ parentKey, item: it, childFrom, childDuration });
    }
  }
  return out;
}

/** Depth-first tree rows [key, depth, trail] from the root, following nested references.
 *  `trail` is the root→key path — the row's OCCURRENCE: a comp placed twice renders two rows,
 *  and selection keys off the trail so only the clicked one highlights. */
export function treeRows(rootKey: string, registry: CompRegistry, graph: ItemGraph): [string, number, string[]][] {
  const rows: [string, number, string[]][] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number, trail: string[]) => {
    rows.push([key, depth, trail]);
    if (seen.has(key)) return; // cycle guard — show but don't expand twice
    seen.add(key);
    for (const child of childrenOf(key, registry, graph)) walk(child, depth + 1, [...trail, child]);
  };
  walk(rootKey, 0, [rootKey]);
  return rows;
}
