import { writable, type Readable } from "svelte/store";
import type {
  AssetDescriptor,
  AssetManager,
  CompositionDescriptor,
  ScriptSheetSnapshot,
  ScriptSourceEdit,
  StudioSession,
} from "@framediff/studio-model";

export interface ScriptViewSnapshot {
  compositionKey: string;
  composition: CompositionDescriptor | null;
  compositions: CompositionDescriptor[];
  assets: AssetDescriptor[];
  sheet: ScriptSheetSnapshot | null;
  frame: number;
  playing: boolean;
  editing: boolean;
  loading: boolean;
  error: string | null;
}

const emptyState = (): ScriptViewSnapshot => ({
  compositionKey: "",
  composition: null,
  compositions: [],
  assets: [],
  sheet: null,
  frame: 0,
  playing: false,
  editing: false,
  loading: false,
  error: null,
});

export class ScriptViewModel {
  public readonly store: Readable<ScriptViewSnapshot>;
  private readonly setStore: (value: ScriptViewSnapshot) => void;
  private snapshot = emptyState();
  private generation = 0;
  private previousEditing = false;
  private unsubscribeSession: () => void;
  private unsubscribeAssets: () => void;

  public constructor(
    private readonly session: StudioSession,
    assets: AssetManager,
  ) {
    const store = writable(this.snapshot);
    this.store = { subscribe: store.subscribe };
    this.setStore = store.set;
    this.unsubscribeAssets = assets.state.subscribe((state) => {
      this.update({ assets: state.assets });
    });
    this.unsubscribeSession = session.state.subscribe((state) => {
      const composition = state.compositions.find((entry) => entry.key === state.currentKey) ?? null;
      const changed = state.currentKey !== this.snapshot.compositionKey;
      const registryChanged = state.compositions !== this.snapshot.compositions;
      const finishedEditing = this.previousEditing && !state.editing;
      this.previousEditing = state.editing;
      this.update({
        compositionKey: state.currentKey,
        composition,
        compositions: state.compositions,
        frame: state.frame,
        playing: state.playing,
        editing: state.editing,
      });
      if (composition?.kind === "script" && (changed || registryChanged || finishedEditing)) void this.refresh();
      else if (composition?.kind !== "script" && this.snapshot.sheet) this.update({ sheet: null });
    });
  }

  public destroy(): void {
    this.unsubscribeSession();
    this.unsubscribeAssets();
  }

  private update(patch: Partial<ScriptViewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.setStore(this.snapshot);
  }

  public async refresh(): Promise<void> {
    const compositionKey = this.snapshot.compositionKey;
    const probe = this.session.runtime.probeScriptSheet;
    if (!compositionKey || !probe) {
      this.update({ sheet: null, loading: false, error: "This runtime does not support script sheets." });
      return;
    }
    const generation = ++this.generation;
    this.update({ loading: true, error: null });
    try {
      const sheet = await probe.call(this.session.runtime, compositionKey);
      if (generation !== this.generation || compositionKey !== this.snapshot.compositionKey) return;
      this.update({ sheet, loading: false, error: sheet ? null : "This script does not expose the sheet row contract." });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async mutate(request: Parameters<StudioSession["editPlan"]>[0]): Promise<boolean> {
    const ok = await this.session.editPlan(request);
    if (ok) await this.refresh();
    return ok;
  }

  public retime(rowId: string, durationInFrames: number) {
    return this.mutate({ type: "retime", rowId, durationInFrames });
  }

  public move(rowId: string, beforeId: string | null) {
    return this.mutate({ type: "move", rowId, beforeId });
  }

  public remove(rowId: string) {
    return this.mutate({ type: "delete", rowId });
  }

  public insert(beforeId: string | null = null, durationInFrames?: number) {
    return this.mutate({ type: "insert", beforeId, durationInFrames });
  }

  public setSource(rowId: string, source: ScriptSourceEdit) {
    return this.mutate({ type: "source", rowId, source });
  }

  public async editText(elementId: string, text: string): Promise<boolean> {
    if (!elementId) return false;
    const ok = await this.session.editElementText({
      compositionKey: this.snapshot.compositionKey,
      objectId: elementId,
    }, text);
    if (ok) await this.refresh();
    return ok;
  }

  public setFrame(frame: number): void {
    this.session.setFrame(frame);
  }

  public togglePlaying(): void {
    this.session.togglePlaying();
  }
}
