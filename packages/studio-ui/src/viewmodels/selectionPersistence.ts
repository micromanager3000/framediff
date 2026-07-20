import type { ProjectObjectKind, ProjectObjectRef, StudioSession, StudioSessionState } from "@framediff/studio-model";

interface StoredStudioSelection {
  version: 1;
  selection: ProjectObjectRef;
  selectedItemId: string | null;
}

const supportedKinds = new Set<ProjectObjectKind>(["clip", "element", "animation"]);

function isStoredStudioSelection(value: unknown): value is StoredStudioSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredStudioSelection>;
  const selection = candidate.selection as Partial<ProjectObjectRef> | undefined;
  return candidate.version === 1
    && (candidate.selectedItemId === null || typeof candidate.selectedItemId === "string")
    && !!selection
    && typeof selection.compositionKey === "string"
    && typeof selection.objectId === "string"
    && typeof selection.kind === "string"
    && supportedKinds.has(selection.kind as ProjectObjectKind);
}

/**
 * Keep the stable project-object identity, not just its owning timeline row. Element and animation
 * selections otherwise collapse to the wrong Inspector surface after a refresh or HMR fallback.
 */
export function serializeStudioSelection(state: Pick<StudioSessionState, "selection" | "selectedItemId">): string | null {
  if (!state.selection || !supportedKinds.has(state.selection.kind)) return null;
  return JSON.stringify({ version: 1, selection: state.selection, selectedItemId: state.selectedItemId } satisfies StoredStudioSelection);
}

export function restoreStudioSelection(session: StudioSession, stored: string | null): boolean {
  if (!stored) return false;

  let decoded: StoredStudioSelection | null = null;
  try {
    const value: unknown = JSON.parse(stored);
    if (isStoredStudioSelection(value)) decoded = value;
  } catch {
    // Backward compatibility with the original storage format, which was a bare timeline item ID.
    if (session.currentItems.some((item) => item.id === stored)) {
      session.selectItem(stored);
      return true;
    }
  }

  if (!decoded || decoded.selection.compositionKey !== session.state.get().currentKey) return false;
  const { selection, selectedItemId } = decoded;
  if (selection.kind === "clip") {
    if (!session.currentItems.some((item) => item.id === selection.objectId)) return false;
    session.selectItem(selection.objectId);
    return true;
  }
  if (selection.kind === "element") {
    const ownerItemId = selectedItemId && session.currentItems.some((item) => item.id === selectedItemId)
      ? selectedItemId
      : undefined;
    session.selectElement(selection.objectId, ownerItemId);
    return true;
  }
  if (selection.kind === "animation") {
    if (!session.currentAnimations.some((animation) => animation.id === selection.objectId)) return false;
    session.selectAnimation(selection.objectId);
    return true;
  }
  return false;
}
