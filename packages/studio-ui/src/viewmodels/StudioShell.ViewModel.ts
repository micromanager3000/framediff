import { derived, type Readable } from "svelte/store";
import type { CompositionDescriptor, StudioGuideDescriptor, StudioSession } from "@framediff/studio-model";
import { sessionStore } from "./store";

export interface StudioShellSnapshot {
  current?: CompositionDescriptor;
  path: CompositionDescriptor[];
  frame: number;
  playing: boolean;
  loading: boolean;
  editing: boolean;
  error: string | null;
  notice: string | null;
  guide?: StudioGuideDescriptor;
}

export class StudioShellViewModel {
  public readonly store: Readable<StudioShellSnapshot>;

  public constructor(public readonly session: StudioSession) {
    this.store = derived(sessionStore(session), (state) => ({
      current: state.compositions.find((entry) => entry.key === state.currentKey),
      path: state.path.flatMap((key) => state.compositions.find((entry) => entry.key === key) ?? []),
      frame: state.frame,
      playing: state.playing,
      loading: state.loading,
      editing: state.editing,
      error: state.error,
      notice: state.notice,
      guide: state.guide,
    }));
  }

  public togglePlaying(): void {
    this.session.togglePlaying();
  }

  public setFrame(frame: number): void {
    this.session.pause();
    this.session.setFrame(frame);
  }

  public refresh(): Promise<void> {
    return this.session.refresh();
  }

  public goUp(): void {
    this.session.goUp();
  }

  public open(compositionKey: string): void {
    this.session.navigate(compositionKey);
  }
}
