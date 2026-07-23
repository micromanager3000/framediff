import { compositionByReference } from "./compositionRef";
import type { CompositionDescriptor, StudioSessionState } from "./types";

type RenderTargetState = Pick<
  StudioSessionState,
  "compositions" | "currentKey" | "path" | "timelineByComposition"
>;

/** Project deliverables are the non-library edit compositions shown as assembly roots. */
export function renderTargetCompositions(state: RenderTargetState): CompositionDescriptor[] {
  const editTargets = state.compositions.filter((composition) => composition.kind === "edit" && !composition.library);
  if (editTargets.length) return editTargets;

  // Small/specialized projects may not declare an edit composition. Preserve the old
  // ability to render their active composition instead of leaving the control empty.
  const current = state.compositions.find((composition) => composition.key === state.currentKey);
  return current && !current.library ? [current] : [];
}

export function selectedRenderTarget(
  state: RenderTargetState,
  targets = renderTargetCompositions(state),
): CompositionDescriptor | undefined {
  const direct = targets.find((target) => target.key === state.currentKey);
  if (direct) return direct;

  const pathTarget = state.path
    .map((key) => targets.find((target) => target.key === key))
    .find((target): target is CompositionDescriptor => !!target);
  if (pathTarget) return pathTarget;

  const contains = (rootKey: string, targetKey: string, seen = new Set<string>()): boolean => {
    if (rootKey === targetKey) return true;
    if (seen.has(rootKey)) return false;
    seen.add(rootKey);
    for (const item of state.timelineByComposition[rootKey] ?? []) {
      if (item.content.type !== "nested") continue;
      const child = compositionByReference(state.compositions, item.content.compId);
      if (child && contains(child.key, targetKey, seen)) return true;
    }
    return false;
  };

  return targets.find((target) => contains(target.key, state.currentKey)) ?? targets[0];
}
