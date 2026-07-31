import { ObservableValue } from "./observable";
import { errorMessage } from "./errors";
import { frontTrimPlacement } from "./timeline";
import { fitGesturePath, makeArcSegment, motionPathToSvg, sampleGestureByFrame, type MotionPoint } from "./motionPath";
import { compositionByReference } from "./compositionRef";
import type {
  AnimationCreateRequest,
  AnimationClock,
  AnimationEditRequest,
  AnimationMutation,
  CompositionDescriptor,
  CompositionRuntimePort,
  PlacementEditResult,
  PlacementField,
  PlanEditIntent,
  PlanEditRequest,
  PreviewElementPatch,
  StudioSessionState,
  TimelineDeleteRequest,
  TimelineItemSnapshot,
  TimelineShapeCreateRequest,
} from "./types";

function initialState(runtime: CompositionRuntimePort, requestedKey?: string): StudioSessionState {
  const compositions = runtime.getCompositions();
  const requested = requestedKey && compositions.some((entry) => entry.key === requestedKey) ? requestedKey : undefined;
  const initialKey = requested ?? compositions[0]?.key ?? "";
  const initial = compositions.find((entry) => entry.key === initialKey);
  return {
    compositions,
    currentKey: initialKey,
    path: [initialKey].filter(Boolean),
    // the playhead rests at the render window's start — the output's t0 (may be negative)
    frame: initial?.render?.from ?? 0,
    playing: false,
    gradeBypass: false,
    selectedItemId: null,
    selection: null,
    timelineByComposition: {},
    animationsByComposition: {},
    animationDiagnosticsByComposition: {},
    animationOpaqueCountByComposition: {},
    autoKey: false,
    gestureDraft: null,
    unrollGroupsByComposition: {},
    loading: true,
    editing: false,
    error: null,
    notice: null,
  };
}

function sole3dShot(
  compositions: CompositionDescriptor[],
  compositionKey: string,
  timelineByComposition: Record<string, TimelineItemSnapshot[]>,
): TimelineItemSnapshot | undefined {
  if (compositions.find((entry) => entry.key === compositionKey)?.kind !== "3d") return undefined;
  const items = timelineByComposition[compositionKey] ?? [];
  return items.length === 1 ? items[0] : undefined;
}

export class StudioSession {
  public readonly state: ObservableValue<StudioSessionState>;
  private registryUnsubscribe: (() => void) | null = null;
  private animationHandle: number | null = null;
  private lastAnimationTime = 0;
  private animationFrame = 0;
  private probeGeneration = 0;
  private readonly rootKey: string;

  public constructor(
    public readonly runtime: CompositionRuntimePort,
    private readonly clock: AnimationClock,
    requestedKey?: string,
  ) {
    this.state = new ObservableValue(initialState(runtime, requestedKey));
    this.rootKey = this.state.get().currentKey;
  }

  public async start(): Promise<void> {
    if (this.registryUnsubscribe) return;
    this.registryUnsubscribe = this.runtime.subscribeCompositions((compositions) => {
      this.replaceCompositions(compositions);
      void this.probeAll();
    });
    await this.probeAll();
  }

  public destroy(): void {
    this.pause();
    this.registryUnsubscribe?.();
    this.registryUnsubscribe = null;
  }

  public get currentComposition(): CompositionDescriptor | undefined {
    const state = this.state.get();
    return state.compositions.find((entry) => entry.key === state.currentKey);
  }

  public get currentItems(): TimelineItemSnapshot[] {
    const state = this.state.get();
    return state.timelineByComposition[state.currentKey] ?? [];
  }

  public get currentAnimations() {
    const state = this.state.get();
    return state.animationsByComposition[state.currentKey] ?? [];
  }

  public get currentUnrollGroups() {
    const state = this.state.get();
    return state.unrollGroupsByComposition[state.currentKey] ?? [];
  }

  public navigate(compositionKey: string): void {
    const state = this.state.get();
    const composition = state.compositions.find((entry) => entry.key === compositionKey);
    if (!composition) return;
    this.pause();
    const path = this.findPath(this.rootKey, compositionKey) ?? [compositionKey];
    const shot = sole3dShot(state.compositions, compositionKey, state.timelineByComposition);
    this.state.set({
      ...this.state.get(),
      currentKey: compositionKey,
      path,
      frame: composition.render?.from ?? 0,
      selectedItemId: shot?.id ?? null,
      selection: shot ? { compositionKey, objectId: shot.id, kind: "clip" } : null,
      error: null,
      notice: null,
    });
  }

  public goUp(): void {
    const state = this.state.get();
    if (state.path.length <= 1) return;
    const path = state.path.slice(0, -1);
    const currentKey = path[path.length - 1];
    this.pause();
    const parent = state.compositions.find((entry) => entry.key === currentKey);
    const shot = sole3dShot(state.compositions, currentKey, state.timelineByComposition);
    this.state.set({
      ...state,
      path,
      currentKey,
      frame: parent?.render?.from ?? 0,
      selectedItemId: shot?.id ?? null,
      selection: shot ? { compositionKey: currentKey, objectId: shot.id, kind: "clip" } : null,
      error: null,
      notice: null,
    });
  }

  public enterNested(itemId: string): void {
    const item = this.currentItems.find((entry) => entry.id === itemId);
    const content = item?.content;
    if (content?.type !== "nested") return;
    const child = compositionByReference(this.state.get().compositions, content.compId);
    if (!child) return;
    const state = this.state.get();
    this.pause();
    const shot = sole3dShot(state.compositions, child.key, state.timelineByComposition);
    this.state.set({
      ...state,
      currentKey: child.key,
      path: [...state.path, child.key],
      frame: Math.max(0, Math.min(Math.round(content.trimStart * child.fps), child.durationInFrames - 1)),
      selectedItemId: shot?.id ?? null,
      selection: shot ? { compositionKey: child.key, objectId: shot.id, kind: "clip" } : null,
      error: null,
      notice: null,
    });
  }

  public selectItem(itemId: string | null): void {
    this.state.update((state) => ({
      ...state,
      selectedItemId: itemId,
      selection: itemId ? { compositionKey: state.currentKey, objectId: itemId, kind: "clip" } : null,
    }));
  }

  public selectElement(objectId: string | null, ownerItemId?: string): void {
    this.state.update((state) => ({
      ...state,
      selectedItemId: objectId ? ownerItemId ?? objectId : null,
      selection: objectId ? { compositionKey: state.currentKey, objectId, kind: "element" } : null,
    }));
  }

  public selectAnimation(animationId: string | null): void {
    this.state.update((state) => ({
      ...state,
      selectedItemId: null,
      selection: animationId ? { compositionKey: state.currentKey, objectId: animationId, kind: "animation" } : null,
    }));
  }

  public setAutoKey(value: boolean): void {
    this.state.update((state) => ({ ...state, autoKey: value }));
  }

  public async editSelectedElement(
    patch: PreviewElementPatch,
    options: { label?: string; groupId?: string } = {},
  ): Promise<boolean> {
    const state = this.state.get();
    if (!state.selection || state.selection.kind !== "element" || !this.runtime.editElementProperties || state.editing) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const objectId = state.selection.objectId;
    const ownsObject = (target: string) => target.includes(`data-fd-id="${objectId}"`)
      || target.includes(`data-fd-id='${objectId}'`);
    const animationRequests: AnimationEditRequest[] = Object.entries(patch).flatMap(([property, value]) => {
      const animation = this.currentAnimations.find((entry) => entry.editable && ownsObject(entry.target) && entry.bindings[property]);
      return animation && value != null ? [{
        compositionKey: state.currentKey,
        animationId: animation.id,
        mutation: { type: "upsert-key" as const, property, frame: state.frame, value },
        label: options.label ?? `Edit ${property} key`,
        ...(options.groupId ? { groupId: options.groupId } : {}),
      }] : [];
    });
    const animatedProperties = new Set(animationRequests.flatMap((request) => request.mutation.type === "upsert-key" ? [request.mutation.property] : []));
    if (animationRequests.length && this.runtime.editAnimations) {
      const animationResult = await this.runEdit(
        () => this.runtime.editAnimations!(animationRequests),
        "Could not update animation keys.",
      );
      if (!animationResult) return false;
      if (!animationResult.ok) {
        this.state.update((current) => ({ ...current, editing: false, error: animationResult.message ?? "Could not update animation keys." }));
        return false;
      }
    }
    const staticPatch = Object.fromEntries(Object.entries(patch).filter(([property]) => !animatedProperties.has(property))) as PreviewElementPatch;
    const result = Object.keys(staticPatch).length
      ? await this.runEdit(
        () => this.runtime.editElementProperties!({
          compositionKey: state.selection!.compositionKey,
          objectId,
          patch: staticPatch,
          ...options,
        }),
        "Could not update the selected element.",
      )
      : { ok: true };
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not update the selected element.",
      notice: result.ok ? animationRequests.length ? `Updated motion at frame ${state.frame}.` : `Updated ${objectId}.` : null,
    }));
    if (result.ok && animationRequests.length) await this.probeAll();
    return result.ok;
  }

  public async editAnimation(animationId: string, mutation: AnimationMutation, options: { label?: string; groupId?: string } = {}): Promise<boolean> {
    return this.editAnimationMutations(animationId, [mutation], options);
  }

  public async editAnimationMutations(animationId: string, mutations: AnimationMutation[], options: { label?: string; groupId?: string } = {}): Promise<boolean> {
    const state = this.state.get();
    if ((!this.runtime.editAnimations && !this.runtime.editAnimation) || state.editing || !mutations.length) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const requests = mutations.map((mutation) => ({ compositionKey: state.currentKey, animationId, mutation, ...options }));
    const result = await this.runEdit(
      () => this.runtime.editAnimations
        ? this.runtime.editAnimations(requests)
        : this.runtime.editAnimation!(requests[0]),
      "Could not update animation source.",
    );
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not update animation source.",
      notice: result.ok ? `Updated ${animationId}.` : null,
    }));
    if (result.ok) await this.probeAll();
    return result.ok;
  }

  public async createAnimation(request: Omit<AnimationCreateRequest, "compositionKey">): Promise<boolean> {
    const state = this.state.get();
    if (!this.runtime.createAnimation || state.editing) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.createAnimation!({ ...request, compositionKey: state.currentKey }),
      "Could not create animation.",
    );
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not create animation.",
      notice: result.ok ? `Created ${request.property} motion.` : null,
    }));
    if (result.ok) await this.probeAll();
    return result.ok;
  }

  public async editMotionPath(animationId: string, path: string, options: { label?: string; groupId?: string } = {}): Promise<boolean> {
    const state = this.state.get();
    if (!this.runtime.editMotionPath || state.editing) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.editMotionPath!({ compositionKey: state.currentKey, animationId, path, ...options }),
      "Could not update the motion path.",
    );
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not update the motion path.",
      notice: result.ok ? `Updated ${animationId} path.` : null,
    }));
    if (result.ok) await this.probeAll();
    return result.ok;
  }

  public makeArc(animationId: string, curvature = 0.25, direction: "clockwise" | "counterclockwise" = "clockwise"): Promise<boolean> {
    const animation = this.currentAnimations.find((entry) => entry.id === animationId);
    const x = animation?.bindings.x;
    const y = animation?.bindings.y;
    if (!animation || x?.kind !== "keyframes" || y?.kind !== "keyframes" || x.keys.length < 2 || y.keys.length < 2) return Promise.resolve(false);
    const from = { x: Number(x.keys[0].value), y: Number(y.keys[0].value) };
    const to = { x: Number(x.keys.at(-1)!.value), y: Number(y.keys.at(-1)!.value) };
    return this.editMotionPath(animationId, motionPathToSvg([makeArcSegment(from, to, curvature, direction)]), { label: `Make ${animationId} arc` });
  }

  public armGesture(objectId: string, animationId?: string): void {
    const state = this.state.get();
    this.pause();
    this.state.update((current) => ({
      ...current,
      gestureDraft: { objectId, ...(animationId ? { animationId } : {}), status: "armed", startFrame: state.frame, samples: [] },
      error: null,
      notice: `Grab ${objectId} on the canvas to begin. Playback starts on grab and release ends the take.`,
    }));
  }

  public recordGesturePoint(value: MotionPoint): void {
    const state = this.state.get();
    const draft = state.gestureDraft;
    if (!draft || draft.status === "preview") return;
    const samples = sampleGestureByFrame([...draft.samples, { frame: state.frame, x: value.x, y: value.y }]);
    this.state.update((current) => ({
      ...current,
      gestureDraft: current.gestureDraft ? { ...current.gestureDraft, status: "recording", samples } : null,
    }));
    if (draft.status === "armed" && !state.playing) this.play();
  }

  public previewGesture(): void {
    const draft = this.state.get().gestureDraft;
    if (!draft) return;
    this.pause();
    const path = motionPathToSvg(fitGesturePath(draft.samples, 2));
    this.state.update((current) => ({
      ...current,
      gestureDraft: current.gestureDraft ? { ...current.gestureDraft, status: "preview", path } : null,
      notice: path ? `Previewing ${draft.samples.length} frame samples. Commit or record again.` : "Record at least two distinct frames.",
    }));
  }

  public cancelGesture(): void {
    this.pause();
    this.state.update((state) => ({ ...state, gestureDraft: null, error: null, notice: null }));
  }

  public async commitGesture(): Promise<boolean> {
    const state = this.state.get();
    const draft = state.gestureDraft;
    if (!draft?.path || draft.status !== "preview" || state.editing) return false;
    let ok = false;
    if (draft.animationId && this.runtime.editMotionPath) {
      ok = await this.editMotionPath(draft.animationId, draft.path, { label: `Record ${draft.animationId} gesture` });
    } else if (this.runtime.createMotionPath) {
      this.state.update((current) => ({ ...current, editing: true, error: null }));
      const frames = draft.samples.map((sample) => sample.frame);
      const result = await this.runEdit(
        () => this.runtime.createMotionPath!({
          compositionKey: state.currentKey,
          objectId: draft.objectId,
          path: draft.path!,
          startFrame: Math.min(...frames),
          durationInFrames: Math.max(1, Math.max(...frames) - Math.min(...frames)),
          label: `Record ${draft.objectId} gesture`,
        }),
        "Could not commit gesture.",
      );
      if (!result) return false;
      ok = result.ok;
      this.state.update((current) => ({ ...current, editing: false, error: result.ok ? null : result.message ?? "Could not commit gesture." }));
      if (ok) await this.probeAll();
    }
    this.state.update((current) => ({
      ...current,
      gestureDraft: ok ? null : current.gestureDraft,
      notice: ok ? "Move saved as editable frame-based motion." : current.notice,
    }));
    if (ok && !draft.animationId) {
      const createdId = `${draft.objectId}-motion-path`.replace(/[^A-Za-z0-9_-]+/g, "-");
      if (this.currentAnimations.some((animation) => animation.id === createdId)) this.selectAnimation(createdId);
    }
    return ok;
  }

  public async unrollAnimationGroup(groupId: string): Promise<boolean> {
    const state = this.state.get();
    if (!this.runtime.unrollAnimationGroup || state.editing) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.unrollAnimationGroup!({ compositionKey: state.currentKey, groupId }),
      "Could not unroll the helper.",
    );
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not unroll the helper.",
      notice: result.ok ? `${groupId} is now explicit, frame-authored source.` : null,
    }));
    if (result.ok) await this.probeAll();
    return result.ok;
  }

  public async editSelectedElementText(text: string): Promise<boolean> {
    const state = this.state.get();
    if (!state.selection || state.selection.kind !== "element" || state.editing) return false;
    return this.editElementText({ compositionKey: state.selection.compositionKey, objectId: state.selection.objectId }, text);
  }

  /**
   * Commit text to an explicit element. The canvas text editor commits on blur, and the
   * blurring click may already have moved the selection — the write must target the
   * element that was being edited, never "whatever is selected now".
   */
  public async editElementText(target: { compositionKey: string; objectId: string }, text: string): Promise<boolean> {
    if (this.state.get().editing) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.editInspectorField({
        compositionKey: target.compositionKey,
        itemId: target.objectId,
        fieldId: "html:data-fd-text",
        value: text,
      }),
      "Could not update text.",
    );
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not update text.",
      notice: result.ok ? `Updated ${target.objectId} text.` : null,
    }));
    return result.ok;
  }

  /** The playable domain: the comp's own frames, extended to cover the render window. */
  private playableRange(composition: CompositionDescriptor): { lo: number; hi: number } {
    return {
      lo: Math.min(0, composition.render?.from ?? 0),
      hi: Math.max(composition.durationInFrames, composition.render?.to ?? 0),
    };
  }

  public setFrame(frame: number): void {
    const composition = this.currentComposition;
    if (!composition) return;
    const { lo, hi } = this.playableRange(composition);
    const next = Math.max(lo, Math.min(Math.round(frame), hi - 1));
    this.animationFrame = next;
    this.state.update((state) => ({ ...state, frame: next }));
  }

  public togglePlaying(): void {
    if (this.state.get().playing) this.pause();
    else this.play();
  }

  public play(): void {
    if (this.state.get().playing || !this.currentComposition) return;
    this.animationFrame = this.state.get().frame;
    this.lastAnimationTime = this.clock.now();
    this.state.update((state) => ({ ...state, playing: true }));
    this.animationHandle = this.clock.request(this.tick);
  }

  public pause(): void {
    if (this.animationHandle != null) this.clock.cancel(this.animationHandle);
    this.animationHandle = null;
    if (this.state.get().playing) this.state.update((state) => ({ ...state, playing: false }));
  }

  public setGradeBypass(value: boolean): void {
    this.state.update((state) => ({ ...state, gradeBypass: value }));
  }

  public async editSelected(field: Extract<PlacementField, "from" | "durationInFrames">, value: number): Promise<boolean> {
    const state = this.state.get();
    if (!state.selectedItemId || !state.currentKey || state.editing) return false;
    const item = this.currentItems.find((entry) => entry.id === state.selectedItemId);
    if (!item) return false;
    const canEdit = field === "from" ? item.editable?.from : item.editable?.duration;
    if (!canEdit) return false;

    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.editPlacement({
        compositionKey: state.currentKey,
        itemId: item.id,
        field,
        value: Math.round(value),
      }),
      "Could not update the composition source.",
    );
    if (!result) return false;
    if (!result.ok) {
      this.state.update((current) => ({
        ...current,
        editing: false,
        error: result.message ?? "Could not update the composition source.",
      }));
      return false;
    }

    const optimistic: TimelineItemSnapshot = {
      ...item,
      from: field === "from" ? Math.round(value) : item.from,
      durationInFrames: field === "durationInFrames" ? Math.max(1, Math.round(value)) : item.durationInFrames,
    };
    this.state.update((current) => ({
      ...current,
      editing: false,
      notice: `Updated ${field === "from" ? "start" : "duration"}${result.file ? ` in ${result.file}` : ""}.`,
      timelineByComposition: {
        ...current.timelineByComposition,
        [current.currentKey]: (current.timelineByComposition[current.currentKey] ?? []).map((entry) =>
          entry.id === optimistic.id ? optimistic : entry,
        ),
      },
    }));
    return true;
  }

  public async setRenderWindow(from: number, to: number): Promise<boolean> {
    const state = this.state.get();
    if (!state.currentKey || state.editing) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.setRenderWindow(state.currentKey, from, to),
      "Could not update the render window.",
    );
    if (!result) return false;
    if (!result.ok) {
      this.state.update((current) => ({ ...current, editing: false, error: result.message }));
      return false;
    }
    this.state.update((current) => ({
      ...current,
      editing: false,
      notice: result.message,
      compositions: current.compositions.map((composition) =>
        composition.key === state.currentKey
          ? {
              ...composition,
              render: Math.round(from) === 0 && Math.round(to) === composition.durationInFrames
                ? undefined
                : { from: Math.round(from), to: Math.round(to) },
            }
          : composition,
      ),
    }));
    return true;
  }

  public async editTimelineItem(
    itemId: string,
    patch: Partial<Pick<TimelineItemSnapshot, "from" | "durationInFrames" | "layer">>,
  ): Promise<boolean> {
    return (await this.editTimelineItemResult(itemId, patch)).ok;
  }

  public async editPlan(request: PlanEditIntent): Promise<boolean> {
    const state = this.state.get();
    if (!state.currentKey || state.editing || !this.runtime.editPlan) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.editPlan!({ ...request, compositionKey: state.currentKey } as PlanEditRequest),
      "Could not update the script.",
    );
    if (!result) return false;
    this.state.update((current) => ({
      ...current,
      editing: false,
      error: result.ok ? null : result.message ?? "Could not update the script.",
      notice: result.ok ? `${result.receipt?.label ?? "Updated script"}${result.file ? ` in ${result.file}` : ""}.` : null,
    }));
    if (result.ok) await this.probeAll();
    return result.ok;
  }

  /** Same placement kernel as the timeline UI, with the exact receipt/conflict result for agents. */
  public async editTimelineItemResult(
    itemId: string,
    patch: Partial<Pick<TimelineItemSnapshot, "from" | "durationInFrames" | "layer">>,
  ): Promise<PlacementEditResult> {
    const state = this.state.get();
    if (!state.currentKey || state.editing) return { ok: false, message: "The Studio is not ready for a placement edit." };
    const item = this.currentItems.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, message: `Timeline item "${itemId}" was not found.` };
    const requests: { field: PlacementField; value: number }[] = [];
    if (patch.from !== undefined && patch.from !== item.from && item.editable?.from) {
      // negative from is legal: the clip starts before frame 0, already in progress
      requests.push({ field: "from", value: Math.round(patch.from) });
    }
    if (patch.durationInFrames !== undefined && patch.durationInFrames !== item.durationInFrames && item.editable?.duration) {
      requests.push({ field: "durationInFrames", value: Math.max(1, Math.round(patch.durationInFrames)) });
    }
    if (patch.layer !== undefined && patch.layer !== item.layer && item.editable?.layer) {
      requests.push({ field: "layer", value: Math.max(0, Math.round(patch.layer)) });
    }
    let trimmedContent: TimelineItemSnapshot["content"] | undefined;
    const frontTrim = patch.from != null
      && patch.durationInFrames != null
      && patch.from + patch.durationInFrames === item.from + item.durationInFrames
      && item.editable?.trimStart
      && ["nested", "video", "audio"].includes(item.content.type);
    if (frontTrim) {
      const composition = this.currentComposition;
      if (composition) {
        const trim = frontTrimPlacement(item, patch.from!, composition.fps);
        requests.push({ field: "trimStart", value: trim.trimStart });
        trimmedContent = { ...item.content, trimStart: trim.trimStart } as TimelineItemSnapshot["content"];
      }
    }
    if (!requests.length) return { ok: false, message: "The placement patch did not change an editable field." };
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.editPlacements(requests.map((request) => ({
        compositionKey: state.currentKey,
        itemId,
        ...request,
      }))),
      "Could not update placement.",
    );
    if (!result) return { ok: false, message: this.state.get().error ?? "Could not update placement." };
    if (!result.ok) {
      this.state.update((current) => ({ ...current, editing: false, error: result.message ?? "Could not update placement." }));
      return result;
    }
    this.state.update((current) => ({
      ...current,
      editing: false,
      notice: `Updated placement${result.file ? ` in ${result.file}` : ""}.`,
      timelineByComposition: {
        ...current.timelineByComposition,
        [current.currentKey]: (current.timelineByComposition[current.currentKey] ?? []).map((entry) =>
          entry.id === itemId ? { ...entry, ...patch, ...(trimmedContent ? { content: trimmedContent } : {}) } : entry,
        ),
      },
    }));
    // A layer drop may atomically swap or normalize sibling ranks. Re-read the projected
    // timeline so the UI never keeps a stale second copy of those derived rows.
    if (requests.some((request) => request.field === "layer")) {
      await this.probeAll();
      this.state.update((current) => ({
        ...current,
        timelineByComposition: {
          ...current.timelineByComposition,
          [current.currentKey]: (current.timelineByComposition[current.currentKey] ?? []).map((entry) =>
            entry.id === itemId ? { ...entry, ...patch, ...(trimmedContent ? { content: trimmedContent } : {}) } : entry,
          ),
        },
      }));
    }
    return result;
  }

  public async deleteTimelineItems(
    itemIds: string[],
    compactLayer?: TimelineDeleteRequest["compactLayer"],
  ): Promise<boolean> {
    const state = this.state.get();
    const ids = [...new Set(itemIds)];
    if (!state.currentKey || state.editing || !this.runtime.deleteTimelineItems || !ids.length) return false;
    const selected = this.currentItems.filter((item) => ids.includes(item.id));
    if (selected.length !== ids.length || selected.some((item) => !item.editable?.delete)) return false;

    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.deleteTimelineItems!({
        compositionKey: state.currentKey,
        itemIds: ids,
        ...(compactLayer ? { compactLayer } : {}),
      }),
      "Could not delete timeline items.",
    );
    if (!result) return false;
    if (!result.ok) {
      this.state.update((current) => ({ ...current, editing: false, error: result.message ?? "Could not delete timeline items." }));
      return false;
    }

    const category = (item: TimelineItemSnapshot): "video" | "audio" | "grade" =>
      item.content.type === "audio" ? "audio" : item.content.type === "grade-layer" ? "grade" : "video";
    const removedNestedComposition = selected.length === 1 && selected[0].content.type === "nested"
      ? compositionByReference(state.compositions, selected[0].content.compId)
      : undefined;
    this.state.update((current) => {
      const remaining = (current.timelineByComposition[current.currentKey] ?? [])
        .filter((item) => !ids.includes(item.id))
        .map((item) => compactLayer && category(item) === compactLayer.kind && item.layer != null && item.layer > compactLayer.layer
          ? { ...item, layer: item.layer - 1 }
          : item);
      const removedSelection = !!current.selection && (
        ids.includes(current.selection.objectId)
        || (current.selectedItemId != null && ids.includes(current.selectedItemId))
      );
      return {
        ...current,
        editing: false,
        selectedItemId: current.selectedItemId && ids.includes(current.selectedItemId) ? null : current.selectedItemId,
        selection: removedSelection ? null : current.selection,
        notice: compactLayer
          ? `Deleted ${compactLayer.kind} layer ${compactLayer.layer + 1}.`
          : removedNestedComposition
            ? `Removed ${selected[0].name ?? selected[0].id} from the timeline. ${removedNestedComposition.id} remains available.`
            : `Deleted ${selected.length === 1 ? selected[0].name ?? selected[0].id : `${selected.length} timeline items`}.`,
        timelineByComposition: { ...current.timelineByComposition, [current.currentKey]: remaining },
      };
    });
    return true;
  }

  public async refresh(): Promise<void> {
    await this.probeAll();
  }

  private readonly tick = (time: number): void => {
    if (!this.state.get().playing) return;
    const composition = this.currentComposition;
    if (!composition) return this.pause();
    const elapsed = Math.max(0, time - this.lastAnimationTime);
    this.lastAnimationTime = time;
    const { lo, hi } = this.playableRange(composition);
    const span = Math.max(1, hi - lo);
    this.animationFrame = lo + (((this.animationFrame - lo + (elapsed / 1000) * composition.fps) % span) + span) % span;
    this.state.update((state) => ({ ...state, frame: Math.floor(this.animationFrame) }));
    this.animationHandle = this.clock.request(this.tick);
  };

  private replaceCompositions(compositions: CompositionDescriptor[]): void {
    const current = this.state.get();
    const stillExists = compositions.some((entry) => entry.key === current.currentKey);
    const currentKey = stillExists ? current.currentKey : compositions[0]?.key ?? "";
    const comp = compositions.find((entry) => entry.key === currentKey);
    this.state.set({
      ...current,
      compositions,
      currentKey,
      frame: comp ? Math.max(Math.min(0, comp.render?.from ?? 0), Math.min(current.frame, Math.max(comp.durationInFrames, comp.render?.to ?? 0) - 1)) : 0,
      selectedItemId: stillExists ? current.selectedItemId : null,
      selection: stillExists ? current.selection : null,
      path: stillExists ? current.path.filter((key) => compositions.some((entry) => entry.key === key)) : [currentKey].filter(Boolean),
    });
  }

  public async createTimelineShape(shape: TimelineShapeCreateRequest["shape"], from = this.state.get().frame): Promise<boolean> {
    const state = this.state.get();
    if (!state.currentKey || state.editing || !this.runtime.createTimelineShape) return false;
    this.state.update((current) => ({ ...current, editing: true, error: null, notice: null }));
    const result = await this.runEdit(
      () => this.runtime.createTimelineShape!({
        compositionKey: state.currentKey,
        shape,
        from: Math.round(from),
      }),
      "Could not add the shape.",
    );
    if (!result) return false;
    if (!result.ok) {
      this.state.update((current) => ({ ...current, editing: false, error: result.message ?? "Could not add the shape." }));
      return false;
    }
    this.state.update((current) => ({
      ...current,
      editing: false,
      notice: `Added ${shape === "rect" ? "rectangle" : shape} shape${result.file ? ` in ${result.file}` : ""}.`,
    }));
    await this.probeAll();
    return true;
  }

  private async probeAll(): Promise<void> {
    const generation = ++this.probeGeneration;
    const compositions = this.state.get().compositions;
    this.state.update((state) => ({ ...state, loading: true, error: null }));
    try {
      const entries = await Promise.all(compositions.map(async (composition) => {
        const [timeline, animation] = await Promise.all([
          this.runtime.probe(composition.key),
          this.runtime.probeAnimations?.(composition.key) ?? Promise.resolve({ animations: [], diagnostics: [], opaqueCallCount: 0, unrollGroups: [] }),
        ]);
        return [composition.key, timeline, animation] as const;
      }));
      if (generation !== this.probeGeneration) return;
      const timelineByComposition = Object.fromEntries(entries.map(([key, timeline]) => [key, timeline]));
      this.state.update((state) => ({
        ...state,
        loading: false,
        timelineByComposition,
        animationsByComposition: Object.fromEntries(entries.map(([key, , animation]) => [key, animation.animations])),
        animationDiagnosticsByComposition: Object.fromEntries(entries.map(([key, , animation]) => [key, animation.diagnostics])),
        animationOpaqueCountByComposition: Object.fromEntries(entries.map(([key, , animation]) => [key, animation.opaqueCallCount])),
        unrollGroupsByComposition: Object.fromEntries(entries.map(([key, , animation]) => [key, animation.unrollGroups ?? []])),
        path: this.findPath(this.rootKey, state.currentKey, timelineByComposition) ?? state.path,
        ...(() => {
          const shot = sole3dShot(state.compositions, state.currentKey, timelineByComposition);
          return shot && !state.selection
            ? { selectedItemId: shot.id, selection: { compositionKey: state.currentKey, objectId: shot.id, kind: "clip" as const } }
            : {};
        })(),
      }));
    } catch (error) {
      if (generation !== this.probeGeneration) return;
      this.state.update((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async runEdit<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        editing: false,
        notice: null,
        error: errorMessage(error, fallback),
      }));
      return undefined;
    }
  }

  private findPath(
    rootKey: string,
    targetKey: string,
    graph: Record<string, TimelineItemSnapshot[]> = this.state.get().timelineByComposition,
  ): string[] | null {
    const compositions = this.state.get().compositions;
    const visit = (key: string, seen: Set<string>): string[] | null => {
      if (key === targetKey) return [key];
      if (seen.has(key)) return null;
      const nextSeen = new Set(seen).add(key);
      for (const item of graph[key] ?? []) {
        const content = item.content;
        if (content.type !== "nested") continue;
        const child = compositionByReference(compositions, content.compId);
        if (!child) continue;
        const found = visit(child.key, nextSeen);
        if (found) return [key, ...found];
      }
      return null;
    };
    return visit(rootKey, new Set());
  }
}
