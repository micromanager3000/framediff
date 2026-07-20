import type { StudioSessionState } from "./types";

export interface NestVerdict {
  ok: boolean;
  why?: string;
}

/** Guard for nesting source into target: no self, no cycles, and recipes aren't stacks. */
export function canNestComposition(
  state: Pick<StudioSessionState, "compositions" | "timelineByComposition">,
  sourceKey: string,
  targetKey: string,
): NestVerdict {
  const source = state.compositions.find((entry) => entry.key === sourceKey);
  const target = state.compositions.find((entry) => entry.key === targetKey);
  if (!source || !target) return { ok: false, why: "unknown composition" };
  if (target.kind === "generate") return { ok: false, why: `${target.id} is generative — a recipe, not a stack` };
  if (source.id === target.id) return { ok: false, why: `${source.id} can't nest itself` };
  const seen = new Set<string>();
  const contains = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    for (const item of state.timelineByComposition[key] ?? []) {
      const content = item.content;
      if (content.type !== "nested") continue;
      const child = state.compositions.find((entry) => entry.id === content.compId);
      if (!child) continue;
      if (child.id === target.id || contains(child.key)) return true;
    }
    return false;
  };
  if (contains(sourceKey)) return { ok: false, why: `${source.id} already nests ${target.id} — that would loop` };
  return { ok: true };
}
