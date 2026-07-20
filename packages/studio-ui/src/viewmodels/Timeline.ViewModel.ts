import { derived, type Readable } from "svelte/store";
import {
  buildTimelineLanes,
  type AnimationDiagnosticSnapshot,
  type AnimationSnapshot,
  type StudioSession,
  type TimelineLaneSnapshot,
  type UnrollGroupSnapshot,
} from "@framediff/studio-model";
import { sessionStore } from "./store";

export interface TimelineSnapshot {
  currentKey: string;
  durationInFrames: number;
  fps: number;
  frame: number;
  selectedItemId: string | null;
  selectedAnimationId: string | null;
  lanes: TimelineLaneSnapshot[];
  animations: AnimationSnapshot[];
  animationDiagnostics: AnimationDiagnosticSnapshot[];
  unrollGroups: UnrollGroupSnapshot[];
  loading: boolean;
  /** The render window: output t0 = from, output end = to. */
  render: { from: number; to: number };
  /** Per item: how many frames of actual source material it has (nested comps only) —
   *  beyond this the clip is holding its last frame. */
  sourceLimits: Record<string, number>;
}

export class TimelineViewModel {
  public readonly store: Readable<TimelineSnapshot>;

  public constructor(private readonly session: StudioSession) {
    this.store = derived(sessionStore(session), (state) => {
      const composition = state.compositions.find((entry) => entry.key === state.currentKey);
      const items = state.timelineByComposition[state.currentKey] ?? [];
      const sourceLimits: Record<string, number> = {};
      for (const item of items) {
        const content = item.content;
        if (!composition) continue;
        if (content.type === "nested") {
          const child = state.compositions.find((entry) => entry.id === content.compId);
          if (!child) continue;
          const availableSeconds = Math.max(0, child.durationInFrames / child.fps - (content.trimStart ?? 0));
          sourceLimits[item.id] = availableSeconds / Math.max(0.0001, content.playbackRate ?? 1) * composition.fps;
        } else if ((content.type === "video" || content.type === "audio") && item.production?.sourceDurationSeconds != null) {
          const availableSeconds = Math.max(0, item.production.sourceDurationSeconds - (content.trimStart ?? 0));
          sourceLimits[item.id] = availableSeconds / Math.max(0.0001, content.playbackRate ?? 1) * composition.fps;
        }
      }
      return {
        currentKey: state.currentKey,
        durationInFrames: composition?.durationInFrames ?? 1,
        fps: composition?.fps ?? 30,
        frame: state.frame,
        selectedItemId: state.selectedItemId,
        selectedAnimationId: state.selection?.kind === "animation" ? state.selection.objectId : null,
        lanes: buildTimelineLanes(items),
        animations: state.animationsByComposition[state.currentKey] ?? [],
        animationDiagnostics: state.animationDiagnosticsByComposition[state.currentKey] ?? [],
        unrollGroups: state.unrollGroupsByComposition[state.currentKey] ?? [],
        loading: state.loading,
        render: composition?.render ?? { from: 0, to: composition?.durationInFrames ?? 1 },
        sourceLimits,
      };
    });
  }

  public seek(frame: number): void {
    this.session.pause();
    this.session.setFrame(frame);
  }

  public select(itemId: string): void {
    this.session.selectItem(itemId);
  }

  public selectAnimation(animationId: string): void {
    this.session.selectAnimation(animationId);
  }

  public moveAnimationKey(animationId: string, property: string, frame: number, toFrame: number): Promise<boolean> {
    return this.session.editAnimation(animationId, { type: "move-key", property, frame, toFrame }, { label: `Move ${property} key` });
  }

  public moveAnimationKeys(animationId: string, properties: string[], frame: number, toFrame: number): Promise<boolean> {
    return this.session.editAnimationMutations(
      animationId,
      properties.map((property) => ({ type: "move-key" as const, property, frame, toFrame })),
      { label: properties.length === 1 ? `Move ${properties[0]} key` : "Move animation keys" },
    );
  }

  public enter(itemId: string): void {
    this.session.enterNested(itemId);
  }

  public commitPlacement(itemId: string, from: number, durationInFrames: number, layer?: number): Promise<boolean> {
    return this.session.editTimelineItem(itemId, { from, durationInFrames, ...(layer == null ? {} : { layer }) });
  }

  public commitRenderWindow(from: number, to: number): Promise<boolean> {
    return this.session.setRenderWindow(from, to);
  }
}
