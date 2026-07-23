import { describe, expect, it, vi } from "vitest";
import { StudioSession } from "./StudioSession";
import type {
  AnimationClock,
  AnimationCreateRequest,
  AnimationEditRequest,
  AnimationProbeSnapshot,
  CompositionDescriptor,
  CompositionRuntimePort,
  InspectorFieldEditRequest,
  MotionPathCreateRequest,
  MotionPathEditRequest,
  PlacementEditRequest,
  PreviewElementEditRequest,
  PreviewHandle,
  PreviewOptions,
  TimelineItemSnapshot,
  TimelineDeleteRequest,
  UnrollGroupRequest,
} from "./types";

const compositions: CompositionDescriptor[] = [
  { key: "main", id: "Main", width: 1920, height: 1080, fps: 30, durationInFrames: 120, kind: "edit", outputKind: "video", file: "src/Main.tsx" },
  { key: "title", id: "Title", width: 1920, height: 1080, fps: 30, durationInFrames: 60, kind: "edit", outputKind: "video", file: "src/Title.tsx" },
];

const items: TimelineItemSnapshot[] = [
  {
    id: "it:0",
    from: 10,
    durationInFrames: 40,
    name: "Title",
    content: { type: "layers", label: "Title" },
    order: 0,
    origin: "sequence",
    editable: { from: true, duration: true },
  },
];

class FakeRuntime implements CompositionRuntimePort {
  public readonly edits: PlacementEditRequest[] = [];
  public readonly elementEdits: PreviewElementEditRequest[] = [];
  public readonly inspectorEdits: InspectorFieldEditRequest[] = [];
  public readonly animationEdits: AnimationEditRequest[] = [];
  public readonly animationCreates: AnimationCreateRequest[] = [];
  public readonly motionPathEdits: MotionPathEditRequest[] = [];
  public readonly motionPathCreates: MotionPathCreateRequest[] = [];
  public readonly unrollRequests: UnrollGroupRequest[] = [];
  public readonly deleteRequests: TimelineDeleteRequest[] = [];
  private listener: ((next: CompositionDescriptor[]) => void) | null = null;
  public probeItems: TimelineItemSnapshot[] = items;
  public animationProbe: AnimationProbeSnapshot = { animations: [], diagnostics: [], opaqueCallCount: 0 };

  getCompositions(): CompositionDescriptor[] { return compositions; }
  subscribeCompositions(listener: (next: CompositionDescriptor[]) => void): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }
  probe = vi.fn(async (_key: string) => this.probeItems);
  probeAnimations = vi.fn(async () => this.animationProbe);
  async editPlacement(request: PlacementEditRequest) {
    this.edits.push(request);
    return { ok: true, file: "src/Main.tsx" };
  }
  async editPlacements(requests: PlacementEditRequest[]) {
    this.edits.push(...requests);
    return { ok: true, file: "src/Main.tsx" };
  }
  async deleteTimelineItems(request: TimelineDeleteRequest) { this.deleteRequests.push(request); return { ok: true, file: "src/Main.timeline.json" }; }
  async editAnimation(request: AnimationEditRequest) { this.animationEdits.push(request); return { ok: true }; }
  async editAnimations(requests: AnimationEditRequest[]) { this.animationEdits.push(...requests); return { ok: true }; }
  async createAnimation(request: AnimationCreateRequest) { this.animationCreates.push(request); return { ok: true }; }
  async editMotionPath(request: MotionPathEditRequest) { this.motionPathEdits.push(request); return { ok: true }; }
  async createMotionPath(request: MotionPathCreateRequest) { this.motionPathCreates.push(request); return { ok: true }; }
  async unrollAnimationGroup(request: UnrollGroupRequest) { this.unrollRequests.push(request); return { ok: true }; }
  async setRenderWindow(compositionKey: string, from: number, to: number) {
    return { ok: true, message: `Render window set to ${from}–${to}f in ${compositionKey}.` };
  }
  async inspectItem(compositionKey: string, itemId: string) { return { compositionKey, itemId, sections: [] }; }
  async editInspectorField(request: InspectorFieldEditRequest) { this.inspectorEdits.push(request); return { ok: true }; }
  async applyGradePreset() { return { ok: false }; }
  async editElementProperties(request: PreviewElementEditRequest) {
    this.elementEdits.push(request);
    return { ok: true, file: "src/Main.html" };
  }
  mountPreview(_host: HTMLElement, _key: string, _options: PreviewOptions): PreviewHandle {
    throw new Error("not used in a model test");
  }
}

class ManualClock implements AnimationClock {
  public time = 0;
  public callback: ((time: number) => void) | null = null;
  now(): number { return this.time; }
  request(callback: (time: number) => void): number { this.callback = callback; return 1; }
  cancel(): void { this.callback = null; }
  advance(milliseconds: number): void {
    this.time += milliseconds;
    const callback = this.callback;
    this.callback = null;
    callback?.(this.time);
  }
}

describe("StudioSession", () => {
  it("opens a single-shot 3D composition with its camera clip selected", async () => {
    const runtime = new FakeRuntime();
    runtime.probeItems = [{ ...items[0], id: "plane-uizoom", name: "uizoom" }];
    vi.spyOn(runtime, "getCompositions").mockReturnValue([
      ...compositions,
      { key: "camera", id: "HeroPlane3D.uizoom", width: 1920, height: 1080, fps: 24, durationInFrames: 58, kind: "3d", outputKind: "video" },
    ]);

    const session = new StudioSession(runtime, new ManualClock(), "camera");
    await session.start();

    expect(session.state.get()).toMatchObject({
      selectedItemId: "plane-uizoom",
      selection: { compositionKey: "camera", objectId: "plane-uizoom", kind: "clip" },
    });
  });

  it("loads plain timeline snapshots and preserves selection while editing source", async () => {
    const runtime = new FakeRuntime();
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    expect(session.currentItems).toEqual(items);
    session.selectItem("it:0");
    await expect(session.editSelected("from", 24)).resolves.toBe(true);

    expect(runtime.edits).toEqual([{ compositionKey: "main", itemId: "it:0", field: "from", value: 24 }]);
    expect(session.currentItems[0].from).toBe(24);
    expect(session.state.get().selectedItemId).toBe("it:0");
  });

  it("opens nested compositions referenced by stable registry key", async () => {
    const runtime = new FakeRuntime();
    runtime.probe.mockImplementation(async (key: string) => key === "main"
      ? [{
          id: "nested-title",
          from: 10,
          durationInFrames: 40,
          name: "Title",
          content: { type: "nested", compId: "title", trimStart: 0 },
          order: 0,
          origin: "sequence",
        }]
      : []);
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    session.enterNested("nested-title");

    expect(session.state.get()).toMatchObject({
      currentKey: "title",
      path: ["main", "title"],
    });
  });

  it("drives playback through an injected clock", async () => {
    const clock = new ManualClock();
    const session = new StudioSession(new FakeRuntime(), clock, "main");
    await session.start();
    session.play();
    clock.advance(1_000);

    expect(session.state.get().frame).toBe(30);
    session.pause();
    expect(session.state.get().playing).toBe(false);
  });

  it("keeps registered animation projections in the plain Studio state", async () => {
    const runtime = new FakeRuntime();
    runtime.animationProbe = {
      animations: [{
        id: "title-enter",
        target: '[data-fd-id="title"]',
        kind: "fromTo",
        startFrame: 10,
        durationInFrames: 20,
        from: { opacity: 0 },
        to: { opacity: 1 },
        bindings: { opacity: { kind: "keyframes", keys: [{ frame: 10, value: 0 }, { frame: 30, value: 1 }] } },
        authority: "literal",
        editable: true,
        source: { file: "src/Motion.ts", start: 100, end: 220 },
        start: { frame: 10, authority: "frames" },
        duration: { frame: 20, authority: "frames" },
      }],
      diagnostics: [{ code: "opaque", severity: "info", message: "One custom call remains opaque." }],
      opaqueCallCount: 1,
    };
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    expect(session.state.get().animationsByComposition.main[0]).toMatchObject({ id: "title-enter", startFrame: 10 });
    expect(session.state.get().animationDiagnosticsByComposition.main).toHaveLength(1);
  });

  it("routes canvas properties owned by motion to keys at the current frame", async () => {
    const runtime = new FakeRuntime();
    runtime.animationProbe = {
      animations: [{
        id: "title-move",
        target: '[data-fd-id="hero-title"]',
        kind: "fromTo",
        startFrame: 0,
        durationInFrames: 30,
        from: { x: 0, y: 0 },
        to: { x: 100, y: 50 },
        bindings: {
          x: { kind: "keyframes", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 100 }] },
          y: { kind: "keyframes", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 50 }] },
        },
        authority: "literal",
        editable: true,
        source: { file: "src/Motion.ts", start: 20, end: 200 },
        start: { frame: 0, authority: "frames" },
        duration: { frame: 30, authority: "frames" },
      }],
      diagnostics: [],
      opaqueCallCount: 0,
    };
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();
    session.setFrame(12);
    session.selectElement("hero-title");

    await expect(session.editSelectedElement({ x: 42, y: 18 }, { groupId: "canvas-key" })).resolves.toBe(true);

    expect(runtime.animationEdits).toEqual([
      { compositionKey: "main", animationId: "title-move", mutation: { type: "upsert-key", property: "x", frame: 12, value: 42 }, label: "Edit x key", groupId: "canvas-key" },
      { compositionKey: "main", animationId: "title-move", mutation: { type: "upsert-key", property: "y", frame: 12, value: 18 }, label: "Edit y key", groupId: "canvas-key" },
    ]);
    expect(runtime.elementEdits).toHaveLength(0);
  });

  it("creates a stopwatch tween with auto-key off by default", async () => {
    const runtime = new FakeRuntime();
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();
    expect(session.state.get().autoKey).toBe(false);
    session.setAutoKey(true);
    await expect(session.createAnimation({ objectId: "card", property: "opacity", from: 0, to: 1, startFrame: 5 })).resolves.toBe(true);
    expect(session.state.get().autoKey).toBe(true);
    expect(runtime.animationCreates[0]).toMatchObject({ compositionKey: "main", objectId: "card", property: "opacity", startFrame: 5 });
  });

  it("makes arcs and commits frame-sampled gestures as one path edit", async () => {
    const runtime = new FakeRuntime();
    runtime.animationProbe = {
      animations: [{
        id: "product-flight",
        target: '[data-fd-id="product"]',
        kind: "fromTo",
        startFrame: 0,
        durationInFrames: 30,
        from: { x: 0, y: 0 },
        to: { x: 120, y: 40 },
        bindings: {
          x: { kind: "keyframes", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 120 }] },
          y: { kind: "keyframes", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 40 }] },
        },
        authority: "literal",
        editable: true,
        source: { file: "src/Motion.ts", start: 20, end: 200 },
        start: { frame: 0, authority: "frames" },
        duration: { frame: 30, authority: "frames" },
      }], diagnostics: [], opaqueCallCount: 0,
    };
    const clock = new ManualClock();
    const session = new StudioSession(runtime, clock, "main");
    await session.start();
    await expect(session.makeArc("product-flight", 0.3, "counterclockwise")).resolves.toBe(true);
    expect(runtime.motionPathEdits[0]).toMatchObject({ compositionKey: "main", animationId: "product-flight" });
    expect(runtime.motionPathEdits[0].path).toMatch(/^M0,0 C/);

    session.armGesture("product");
    session.recordGesturePoint({ x: 0, y: 0 });
    clock.advance(34);
    session.recordGesturePoint({ x: 30, y: 18 });
    clock.advance(34);
    session.recordGesturePoint({ x: 70, y: 45 });
    session.previewGesture();
    expect(session.state.get().gestureDraft).toMatchObject({ status: "preview", samples: [{ frame: 0 }, { frame: 1 }, { frame: 2 }] });
    await expect(session.commitGesture()).resolves.toBe(true);
    expect(runtime.motionPathCreates).toHaveLength(1);
    expect(runtime.motionPathCreates[0]).toMatchObject({ compositionKey: "main", objectId: "product", startFrame: 0, durationInFrames: 2 });
    expect(session.state.get().gestureDraft).toBeNull();
  });

  it("uses the same stable selection for canvas and Inspector element edits", async () => {
    const runtime = new FakeRuntime();
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();
    session.selectElement("hero-title", "it:0");

    await expect(session.editSelectedElement({ x: 42, y: 18 }, { groupId: "drag-1" })).resolves.toBe(true);

    expect(session.state.get().selection).toEqual({ compositionKey: "main", objectId: "hero-title", kind: "element" });
    expect(session.state.get().selectedItemId).toBe("it:0");
    expect(runtime.elementEdits).toEqual([{
      compositionKey: "main",
      objectId: "hero-title",
      patch: { x: 42, y: 18 },
      groupId: "drag-1",
    }]);
  });

  it("commits direct canvas text through the Inspector source path", async () => {
    const runtime = new FakeRuntime();
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();
    session.selectElement("hero-title", "it:0");

    await expect(session.editSelectedElementText("A source-native title")).resolves.toBe(true);

    expect(runtime.inspectorEdits).toEqual([{
      compositionKey: "main",
      itemId: "hero-title",
      fieldId: "html:data-fd-text",
      value: "A source-native title",
    }]);
  });

  it("commits timeline move and trim as one atomic placement edit", async () => {
    const runtime = new FakeRuntime();
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    await expect(session.editTimelineItem("it:0", { from: 20, durationInFrames: 30 })).resolves.toBe(true);

    expect(runtime.edits).toEqual([
      { compositionKey: "main", itemId: "it:0", field: "from", value: 20 },
      { compositionKey: "main", itemId: "it:0", field: "durationInFrames", value: 30 },
    ]);
    expect(session.currentItems[0]).toMatchObject({ from: 20, durationInFrames: 30 });
  });

  it("front-trims source seconds and moves persistent layers in the same edit kernel", async () => {
    const runtime = new FakeRuntime();
    runtime.probeItems = [{
      id: "video",
      from: 10,
      durationInFrames: 40,
      layer: 0,
      order: 0,
      origin: "sequence",
      editable: { from: true, duration: true, layer: true, trimStart: true },
      content: { type: "video", src: "asset://hero", trimStart: 1, playbackRate: 1.5 },
    }];
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    await expect(session.editTimelineItem("video", { from: 20, durationInFrames: 30, layer: 2 })).resolves.toBe(true);

    expect(runtime.edits).toEqual([
      { compositionKey: "main", itemId: "video", field: "from", value: 20 },
      { compositionKey: "main", itemId: "video", field: "durationInFrames", value: 30 },
      { compositionKey: "main", itemId: "video", field: "layer", value: 2 },
      { compositionKey: "main", itemId: "video", field: "trimStart", value: 1.5 },
    ]);
    expect(session.currentItems[0]).toMatchObject({
      from: 20,
      durationInFrames: 30,
      layer: 2,
      content: { trimStart: 1.5 },
    });
  });

  it("deletes timeline items and compacts a removed layer optimistically", async () => {
    const runtime = new FakeRuntime();
    runtime.probeItems = [
      {
        id: "video",
        from: 0,
        durationInFrames: 40,
        layer: 0,
        order: 0,
        origin: "sequence",
        editable: { from: true, duration: true, layer: true, delete: true },
        content: { type: "video", src: "asset://hero" },
      },
      {
        id: "overlay",
        from: 0,
        durationInFrames: 40,
        layer: 2,
        order: 1,
        origin: "sequence",
        editable: { from: true, duration: true, layer: true, delete: true },
        content: { type: "layers", label: "Overlay" },
      },
    ];
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();
    session.selectItem("video");

    await expect(session.deleteTimelineItems(["video"], { kind: "video", layer: 0 })).resolves.toBe(true);

    expect(runtime.deleteRequests).toEqual([{
      compositionKey: "main",
      itemIds: ["video"],
      compactLayer: { kind: "video", layer: 0 },
    }]);
    expect(session.currentItems).toEqual([expect.objectContaining({ id: "overlay", layer: 1 })]);
    expect(session.state.get()).toMatchObject({ selectedItemId: null, selection: null, notice: "Deleted video layer 1." });
  });

  it("keeps negative trim when extending a clip left so visual pre-roll can hold frame one", async () => {
    const runtime = new FakeRuntime();
    runtime.probeItems = [{
      id: "video",
      from: 30,
      durationInFrames: 30,
      order: 0,
      origin: "sequence",
      editable: { from: true, duration: true, trimStart: true },
      content: { type: "video", src: "asset://hero", trimStart: 1, playbackRate: 1.5 },
    }];
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    await expect(session.editTimelineItem("video", { from: -10, durationInFrames: 70 })).resolves.toBe(true);

    expect(runtime.edits.at(-1)).toEqual({
      compositionKey: "main",
      itemId: "video",
      field: "trimStart",
      value: -1,
    });
    expect(session.currentItems[0]).toMatchObject({ from: -10, durationInFrames: 70, content: { trimStart: -1 } });
  });

  it("projects safe helper traces and routes unroll through the source-backed runtime", async () => {
    const runtime = new FakeRuntime();
    runtime.animationProbe = {
      animations: [], diagnostics: [], opaqueCallCount: 0,
      unrollGroups: [{
        id: "cards",
        timeline: "timeline",
        source: { file: "src/Motion.ts", start: 80, end: 140 },
        operations: [{ target: '[data-fd-id="card"]', kind: "to", startFrame: 10, durationInFrames: 20, to: { opacity: 1 } }],
        safe: true,
        issues: [],
      }],
    };
    const session = new StudioSession(runtime, new ManualClock(), "main");
    await session.start();

    expect(session.currentUnrollGroups[0]).toMatchObject({ id: "cards", safe: true });
    await expect(session.unrollAnimationGroup("cards")).resolves.toBe(true);
    expect(runtime.unrollRequests).toEqual([{ compositionKey: "main", groupId: "cards" }]);
    expect(session.state.get().notice).toContain("frame-authored source");
  });
});
