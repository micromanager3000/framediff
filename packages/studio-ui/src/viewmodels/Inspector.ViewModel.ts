import { derived, type Readable } from "svelte/store";
import {
  timelineItemLabel,
  type AnimationMutation,
  type AnimationSnapshot,
  type GestureDraftSnapshot,
  type UnrollGroupSnapshot,
  type CompositionDescriptor,
  type InspectorManager,
  type InspectorSectionSnapshot,
  type PlacementField,
  type StudioSession,
  type TimelineItemSnapshot,
} from "@framediff/studio-model";
import { observableStore, sessionStore } from "./store";

export interface InspectorSnapshot {
  composition?: CompositionDescriptor;
  item?: TimelineItemSnapshot;
  elementId?: string;
  animation?: AnimationSnapshot;
  unrollGroup?: UnrollGroupSnapshot;
  elementAnimations: AnimationSnapshot[];
  frame: number;
  autoKey: boolean;
  gestureDraft: GestureDraftSnapshot | null;
  itemLabel?: string;
  editing: boolean;
  error: string | null;
  notice: string | null;
  sections: InspectorSectionSnapshot[];
  detailsLoading: boolean;
}

export class InspectorViewModel {
  public readonly store: Readable<InspectorSnapshot>;

  public constructor(private readonly session: StudioSession, private readonly manager: InspectorManager) {
    this.store = derived([sessionStore(session), observableStore(manager.state)], ([state, managerState]) => {
      const composition = state.compositions.find((entry) => entry.key === state.currentKey);
      const item = (state.timelineByComposition[state.currentKey] ?? []).find((entry) => entry.id === state.selectedItemId);
      const animation = state.selection?.kind === "animation"
        ? (state.animationsByComposition[state.currentKey] ?? []).find((entry) => entry.id === state.selection?.objectId)
        : undefined;
      const unrollGroup = state.selection?.kind === "animation"
        ? (state.unrollGroupsByComposition[state.currentKey] ?? []).find((entry) => entry.id === state.selection?.objectId)
        : undefined;
      const elementAnimations = state.selection?.kind === "element"
        ? (state.animationsByComposition[state.currentKey] ?? []).filter((entry) =>
          entry.target.includes(`data-fd-id="${state.selection?.objectId}"`) || entry.target.includes(`data-fd-id='${state.selection?.objectId}'`),
        )
        : [];
      return {
        composition,
        item,
        elementId: state.selection?.kind === "element" ? state.selection.objectId : undefined,
        animation,
        unrollGroup,
        elementAnimations,
        frame: state.frame,
        autoKey: state.autoKey,
        gestureDraft: state.gestureDraft,
        itemLabel: animation?.id ?? unrollGroup?.id ?? (state.selection?.kind === "element" ? state.selection.objectId : item ? timelineItemLabel(item) : undefined),
        editing: state.editing || managerState.editing,
        error: state.error ?? managerState.error,
        notice: state.notice,
        sections: managerState.details?.sections ?? [],
        detailsLoading: managerState.loading,
      };
    });
  }

  public edit(field: Extract<PlacementField, "from" | "durationInFrames">, value: number): Promise<boolean> {
    return this.session.editSelected(field, value);
  }

  public editField(fieldId: string, value: number | string | boolean): Promise<boolean> {
    const state = this.session.state.get();
    const property = ({
      "html:data-fd-x": "x",
      "html:data-fd-y": "y",
      "html:data-fd-width": "width",
      "html:data-fd-height": "height",
      "html:data-fd-opacity": "opacity",
      "html:data-fd-scale": "scale",
      "html:data-fd-rotation": "rotation",
    } as Record<string, string>)[fieldId];
    if (property && typeof value === "number" && state.selection?.kind === "element") {
      const objectId = state.selection.objectId;
      const animation = (state.animationsByComposition[state.currentKey] ?? []).find((entry) =>
        entry.editable && entry.bindings[property]
        && (entry.target.includes(`data-fd-id="${objectId}"`) || entry.target.includes(`data-fd-id='${objectId}'`)),
      );
      if (animation) {
        const binding = animation.bindings[property];
        const existingFrames = binding.kind === "keyframes" ? binding.keys.map((key) => key.frame) : [];
        const nearestAuthoredFrame = [...existingFrames].sort((left, right) => Math.abs(left - state.frame) - Math.abs(right - state.frame))[0];
        const frame = state.autoKey || existingFrames.includes(state.frame) ? state.frame : nearestAuthoredFrame ?? state.frame;
        return this.session.editAnimation(animation.id, { type: "upsert-key", property, frame, value }, { label: `${state.autoKey ? "Auto-key" : "Edit"} ${property}` });
      }
    }
    return this.manager.edit(fieldId, value);
  }

  public editFields(
    edits: Array<{ fieldId: string; value: number | string | boolean }>,
    options: { label?: string; groupId?: string } = {},
  ): Promise<boolean> {
    return this.manager.editMany(edits, options);
  }

  public applyPreset(presetId: string): Promise<boolean> {
    return this.manager.applyPreset(presetId);
  }

  public editAnimation(animationId: string, mutation: AnimationMutation, label?: string): Promise<boolean> {
    return this.session.editAnimation(animationId, mutation, { label });
  }

  public seek(frame: number): void {
    this.session.pause();
    this.session.setFrame(frame);
  }

  public setAutoKey(value: boolean): void {
    this.session.setAutoKey(value);
  }

  public selectAnimation(animationId: string): void {
    this.session.selectAnimation(animationId);
  }

  public createAnimation(property: string, value: number): Promise<boolean> {
    const state = this.session.state.get();
    const objectId = state.selection?.kind === "element" ? state.selection.objectId : undefined;
    if (!objectId) return Promise.resolve(false);
    const destination = property === "opacity"
      ? value > 0.5 ? 0 : 1
      : property === "scale"
        ? value * 1.2
        : property === "rotation"
          ? value + 45
          : property === "y"
            ? value - 80
            : value + 100;
    return this.session.createAnimation({
      objectId,
      property,
      from: value,
      to: destination,
      startFrame: state.frame,
      durationInFrames: Math.round((this.session.currentComposition?.fps ?? 30)),
      ease: "power2.out",
    });
  }

  public makeArc(animationId: string, curvature: number, direction: "clockwise" | "counterclockwise"): Promise<boolean> {
    return this.session.makeArc(animationId, curvature, direction);
  }

  public editMotionPath(animationId: string, path: string, label?: string): Promise<boolean> {
    return this.session.editMotionPath(animationId, path, { label });
  }

  public armGesture(): void {
    const state = this.session.state.get();
    const animation = state.selection?.kind === "animation"
      ? (state.animationsByComposition[state.currentKey] ?? []).find((entry) => entry.id === state.selection?.objectId)
      : undefined;
    const objectId = state.selection?.kind === "element"
      ? state.selection.objectId
      : animation?.target.match(/data-fd-id=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean);
    if (objectId) this.session.armGesture(objectId, animation?.id);
  }

  public commitGesture(): Promise<boolean> {
    return this.session.commitGesture();
  }

  public cancelGesture(): void {
    this.session.cancelGesture();
  }

  public unrollGroup(groupId: string): Promise<boolean> {
    return this.session.unrollAnimationGroup(groupId);
  }

  public enterNested(): void {
    const itemId = this.session.state.get().selectedItemId;
    if (itemId) this.session.enterNested(itemId);
  }

  public clearSelection(): void {
    this.session.selectItem(null);
  }
}
