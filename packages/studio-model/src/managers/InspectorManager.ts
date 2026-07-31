import { ObservableValue } from "../observable";
import { errorMessage } from "../errors";
import type { CompositionRuntimePort, InspectorDetailsSnapshot } from "../types";
import type { InspectorControlSnapshot } from "../types";
import type { StudioSession } from "../StudioSession";

export interface InspectorManagerState {
  details: InspectorDetailsSnapshot | null;
  loading: boolean;
  editing: boolean;
  error: string | null;
}

export class InspectorManager {
  public readonly state = new ObservableValue<InspectorManagerState>({ details: null, loading: false, editing: false, error: null });
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private lastKey = "";

  public constructor(
    private readonly session: StudioSession,
    private readonly runtime: CompositionRuntimePort,
  ) {}

  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.state.subscribe((state) => {
      const compositionId = state.compositions.find((entry) => entry.key === state.currentKey)?.id;
      const selectedObjectId = state.selection?.objectId ?? state.selectedItemId ?? compositionId;
      // Probe transitions are also source-revision boundaries. Reload the selected object's
      // details so Undo/Redo and HMR cannot leave a source-backed field showing a stale draft.
      const key = `${state.currentKey}:${state.selection?.kind ?? ""}:${selectedObjectId ?? ""}:${state.timelineByComposition[state.currentKey]?.length ?? 0}:${state.animationsByComposition[state.currentKey]?.length ?? 0}:${state.loading}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      void this.load();
    });
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public async load(): Promise<void> {
    const state = this.session.state.get();
    const generation = ++this.generation;
    const compositionId = state.compositions.find((entry) => entry.key === state.currentKey)?.id;
    const selectedObjectId = state.selection?.objectId ?? state.selectedItemId ?? compositionId;
    if (!selectedObjectId || state.selection?.kind === "animation") {
      this.state.set({ details: null, loading: false, editing: false, error: null });
      return;
    }
    this.state.update((current) => ({ ...current, loading: true, error: null }));
    try {
      const details = await this.runtime.inspectItem(state.currentKey, selectedObjectId);
      if (generation !== this.generation) return;
      this.state.set({ details, loading: false, editing: false, error: null });
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.set({ details: null, loading: false, editing: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  public async edit(fieldId: string, value: number | string | boolean): Promise<boolean> {
    const details = this.state.get().details;
    if (!details || this.state.get().editing) return false;
    this.state.update((state) => ({ ...state, editing: true, error: null }));
    try {
      const result = await this.runtime.editInspectorField({
        compositionKey: details.compositionKey,
        itemId: details.itemId,
        fieldId,
        value,
      });
      if (!result.ok) {
        this.state.update((state) => ({ ...state, editing: false, error: result.message ?? "Could not edit field." }));
        return false;
      }
      this.applyEditedValues([{ fieldId, value }]);
      return true;
    } catch (error) {
      this.failEdit(error, "Could not edit field.");
      return false;
    }
  }

  public async editMany(
    edits: Array<{ fieldId: string; value: number | string | boolean }>,
    options: { label?: string; groupId?: string } = {},
  ): Promise<boolean> {
    const details = this.state.get().details;
    if (!details || this.state.get().editing || !edits.length) return false;
    this.state.update((state) => ({ ...state, editing: true, error: null }));
    try {
      if (!this.runtime.editInspectorFields) {
        for (const edit of edits) {
          const result = await this.runtime.editInspectorField({
            compositionKey: details.compositionKey,
            itemId: details.itemId,
            ...edit,
          });
          if (!result.ok) {
            this.state.update((state) => ({ ...state, editing: false, error: result.message ?? "Could not edit fields." }));
            return false;
          }
        }
      } else {
        const result = await this.runtime.editInspectorFields({
          compositionKey: details.compositionKey,
          itemId: details.itemId,
          edits,
          ...options,
        });
        if (!result.ok) {
          this.state.update((state) => ({ ...state, editing: false, error: result.message ?? "Could not edit fields." }));
          return false;
        }
      }
      this.applyEditedValues(edits);
      return true;
    } catch (error) {
      this.failEdit(error, "Could not edit fields.");
      return false;
    }
  }

  private applyEditedValues(edits: Array<{ fieldId: string; value: number | string | boolean }>): void {
    // A source write can trigger HMR/probing before its request resolves. Any Inspector load that
    // started in that window describes the pre-edit source and must not overwrite this accepted,
    // optimistic snapshot when it finishes later.
    this.generation += 1;
    const values = new Map(edits.map((edit) => [edit.fieldId, edit.value]));
    this.state.update((state) => ({
      ...state,
      editing: false,
      details: state.details ? {
        ...state.details,
        sections: state.details.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => {
            const value = values.get(field.id);
            if (value === undefined) return field;
            return typeof value === "number"
              ? { ...field, value, control: field.control ? { ...field.control, value } as InspectorControlSnapshot : undefined }
              : typeof value === "boolean"
                ? { ...field, boolean: value, control: field.control ? { ...field.control, value } as InspectorControlSnapshot : undefined }
                : { ...field, text: value, control: field.control ? { ...field.control, value } as InspectorControlSnapshot : undefined };
          }),
        })),
      } : null,
    }));
  }

  public async applyPreset(presetId: string): Promise<boolean> {
    const details = this.state.get().details;
    if (!details || this.state.get().editing) return false;
    this.state.update((state) => ({ ...state, editing: true, error: null }));
    try {
      const result = await this.runtime.applyGradePreset(details.compositionKey, details.itemId, presetId);
      this.state.update((state) => ({ ...state, editing: false, error: result.ok ? null : result.message ?? "Could not apply preset." }));
      if (result.ok) void this.load();
      return result.ok;
    } catch (error) {
      this.failEdit(error, "Could not apply preset.");
      return false;
    }
  }

  private failEdit(error: unknown, fallback: string): void {
    this.state.update((state) => ({
      ...state,
      editing: false,
      error: errorMessage(error, fallback),
    }));
  }
}
