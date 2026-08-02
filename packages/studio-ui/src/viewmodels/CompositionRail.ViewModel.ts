import { derived, type Readable } from "svelte/store";
import { canNestComposition, compositionByReference, type CompositionDescriptor, type StudioSession } from "@framediff/studio-model";
import { sessionStore } from "./store";

export interface CompositionRailSnapshot {
  currentKey: string;
  primary: { composition: CompositionDescriptor; depth: number }[];
  library: CompositionDescriptor[];
  /** Composition the project's walkthrough opens on, badged as the way in. */
  guideEntryKey: string;
}

export function compositionMatchesSearch(composition: CompositionDescriptor, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [composition.id, composition.key, composition.kind, composition.file ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

export class CompositionRailViewModel {
  public readonly store: Readable<CompositionRailSnapshot>;

  public constructor(private readonly session: StudioSession) {
    this.store = derived(sessionStore(session), (state) => {
      const rows: { composition: CompositionDescriptor; depth: number }[] = [];
      const seen = new Set<string>();
      const walk = (key: string, depth: number) => {
        if (seen.has(key)) return;
        const composition = state.compositions.find((entry) => entry.key === key);
        if (!composition) return;
        // library comps are not stack roots, but they DO belong in the tree where they nest
        if (composition.library && depth === 0) return;
        seen.add(key);
        rows.push({ composition, depth });
        for (const item of state.timelineByComposition[key] ?? []) {
          const content = item.content;
          if (content.type !== "nested") continue;
          const child = compositionByReference(state.compositions, content.compId);
          if (child) walk(child.key, depth + 1);
        }
      };
      // a stable forest in registry order — every non-library comp roots a tree, so the
      // rail keeps its shape no matter which composition is open
      for (const composition of state.compositions) walk(composition.key, 0);
      return {
        currentKey: state.currentKey,
        primary: rows,
        library: state.compositions.filter((entry) => entry.library),
        guideEntryKey: state.guide?.entryCompositionKey ?? "",
      };
    });
  }

  public open(compositionKey: string): void {
    this.session.navigate(compositionKey);
  }

  public canNest(sourceKey: string, targetKey: string): boolean {
    return canNestComposition(this.session.state.get(), sourceKey, targetKey).ok;
  }
}
