import type { StudioSessionState } from "./types";
import { compositionKindAuthoringDefaults } from "./authoring";
import { compositionByReference } from "./compositionRef";

export interface NestVerdict {
  ok: boolean;
  why?: string;
}

/** Guard for placing one composition as a timed layer in an edit. */
export function canNestComposition(
  state: Pick<StudioSessionState, "compositions" | "timelineByComposition">,
  sourceKey: string,
  targetKey: string,
): NestVerdict {
  const source = state.compositions.find((entry) => entry.key === sourceKey);
  const target = state.compositions.find((entry) => entry.key === targetKey);
  if (!source || !target) return { ok: false, why: "unknown composition" };
  if (!compositionKindAuthoringDefaults(target.kind).acceptsCompositionDrop) {
    return { ok: false, why: `${target.id} is a ${target.kind} composition — it does not accept timeline clips` };
  }
  if (source.id === target.id) return { ok: false, why: `${source.id} can't nest itself` };
  const seen = new Set<string>();
  const contains = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    for (const item of state.timelineByComposition[key] ?? []) {
      const content = item.content;
      if (content.type !== "nested") continue;
      const child = compositionByReference(state.compositions, content.compId);
      if (!child) continue;
      if (child.id === target.id || contains(child.key)) return true;
    }
    return false;
  };
  if (contains(sourceKey)) return { ok: false, why: `${source.id} already nests ${target.id} — that would loop` };
  return { ok: true };
}
