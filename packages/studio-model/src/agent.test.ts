import { describe, expect, it, vi } from "vitest";
import { StudioApplication } from "./StudioApplication";
import { StudioAgentApi } from "./agent";
import type {
  AnimationClock,
  AnimationProbeSnapshot,
  AssetDescriptor,
  CacheEntryDescriptor,
  CompositionDescriptor,
  PreviewHandle,
  PreviewOptions,
  ProjectEditListener,
  ProjectEditReceipt,
  SourceFileRevisionSnapshot,
  StudioRuntimePort,
  TimelineItemSnapshot,
} from "./types";

const comp: CompositionDescriptor = {
  key: "main", id: "Main", width: 1920, height: 1080, fps: 30,
  durationInFrames: 90, kind: "edit", outputKind: "video", file: "src/Main.html",
};

const revision = (file: string, text: string): SourceFileRevisionSnapshot => ({ file, text, hash: `test:${text}` });

class AgentRuntime implements StudioRuntimePort {
  public sources = new Map([
    ["src/Main.html", '<main data-fd-id="Main"></main>'],
    ["src/Motion.ts", "timeline.to(card, { x: 20 })"],
  ]);
  public items: TimelineItemSnapshot[] = [{
    id: "clip", from: 0, durationInFrames: 30, order: 0, layer: 0, origin: "sequence",
    editable: { from: true, duration: true, layer: true, trimStart: true },
    content: { type: "video", src: "asset://local", trimStart: 2, playbackRate: 1 },
    production: { assetId: "local", contentHash: "sha256:asset", availability: "local", effects: false },
  }];
  public animations: AnimationProbeSnapshot = {
    animations: [{
      id: "card-move", target: '[data-fd-id="card"]', kind: "fromTo", startFrame: 0, durationInFrames: 30,
      from: { x: 0 }, to: { x: 100 }, bindings: { x: { kind: "keyframes", keys: [{ frame: 0, value: 0 }, { frame: 30, value: 100 }] } },
      authority: "literal", editable: true, source: { file: "src/Motion.ts", start: 0, end: 32 },
      start: { frame: 0, authority: "frames" }, duration: { frame: 30, authority: "frames" },
    }],
    diagnostics: [{ code: "opaque", severity: "warning", message: "A custom helper remains opaque.", source: { file: "src/Motion.ts", start: 33, end: 45 } }],
    opaqueCallCount: 1,
    unrollGroups: [],
  };
  public placementRequests: Array<{ itemId: string; field: string; value: number }> = [];
  public listeners = new Set<ProjectEditListener>();
  public replayed: Array<"undo" | "redo"> = [];
  public snapshots: Array<{ key: string; frame: number }> = [];
  public nextPlacementConflict = false;
  public cache: CacheEntryDescriptor[] = [{
    name: "sha256:bake", contentHash: "sha256:bake", size: 1200, mtimeMs: 1,
    compId: "Main", label: "Main bake", inputs: { "src/Main.html": "sha256:older" },
  }];
  private compositionListener: ((compositions: CompositionDescriptor[]) => void) | null = null;

  getCompositions() { return [comp]; }
  subscribeCompositions(listener: (compositions: CompositionDescriptor[]) => void) { this.compositionListener = listener; return () => { this.compositionListener = null; }; }
  subscribeProjectEdits(listener: ProjectEditListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async probe() { return this.items; }
  async probeAnimations() { return this.animations; }
  async readSource(file: string) { return this.sources.get(file) ?? null; }
  async listAssets(): Promise<AssetDescriptor[]> { return [
    { id: "local", name: "Local.mov", filename: "Local--sha256.mp4", mime: "video/mp4", bytes: 100, contentHash: "sha256:asset" },
    { id: "remote", name: "Remote.mov", mime: "video/mp4", bytes: 200, contentHash: "sha256:remote" },
  ]; }
  async getGitStatus() { return [" M src/Main.html"]; }
  async listCacheEntries() { return this.cache; }

  async editPlacement(request: { compositionKey: string; itemId: string; field: "from" | "durationInFrames" | "layer" | "trimStart"; value: number }) { return this.editPlacements([request]); }
  async editPlacements(requests: Array<{ compositionKey: string; itemId: string; field: "from" | "durationInFrames" | "layer" | "trimStart"; value: number }>) {
    if (this.nextPlacementConflict) {
      this.nextPlacementConflict = false;
      this.sources.set("src/Main.html", "racing external edit");
      return { ok: false, message: "Source changed since it was inspected.", conflicts: [{ file: "src/Main.html", expectedHash: "test:before", actualHash: "test:external" }] };
    }
    this.placementRequests.push(...requests);
    this.items = this.items.map((item) => {
      if (item.id !== requests[0]?.itemId) return item;
      const values = new Map(requests.map((request) => [request.field, request.value]));
      return {
        ...item,
        ...(values.has("from") ? { from: values.get("from")! } : {}),
        ...(values.has("durationInFrames") ? { durationInFrames: values.get("durationInFrames")! } : {}),
        ...(values.has("layer") ? { layer: values.get("layer")! } : {}),
        ...(values.has("trimStart") ? { content: { ...item.content, trimStart: values.get("trimStart")! } as TimelineItemSnapshot["content"] } : {}),
      };
    });
    const file = "src/Main.html";
    const before = this.sources.get(file)!;
    const after = `${before}\n<!-- ${requests.map((request) => `${request.field}:${request.value}`).join(",")} -->`;
    this.sources.set(file, after);
    const receipt: ProjectEditReceipt = { id: `edit-${this.placementRequests.length}`, label: "Edit clip placement", before: [revision(file, before)], after: [revision(file, after)] };
    for (const listener of this.listeners) listener(receipt);
    return { ok: true, file, receipt };
  }
  async replayProjectEdit(receipt: ProjectEditReceipt, direction: "undo" | "redo") {
    this.replayed.push(direction);
    for (const source of direction === "undo" ? receipt.before : receipt.after) {
      if (source.text == null) this.sources.delete(source.file); else this.sources.set(source.file, source.text);
    }
    return { ok: true };
  }
  async captureFrame(compositionKey: string, frame: number) {
    this.snapshots.push({ key: compositionKey, frame });
    return { compositionKey, frame, width: 1920, height: 1080, mime: "image/png" as const, contentHash: "sha256:png", dataUrl: "data:image/png;base64,AA==" };
  }

  async inspectItem(compositionKey: string, itemId: string) { return { compositionKey, itemId, sections: [] }; }
  async editInspectorField() { return { ok: false }; }
  async applyGradePreset() { return { ok: false }; }
  async setRenderWindow() { return { ok: false, message: "not used" }; }
  async editElementProperties() { return { ok: false }; }
  mountPreview(_host: HTMLElement, _compositionKey: string, _options: PreviewOptions): PreviewHandle { throw new Error("not used"); }
  async uploadAsset() { return null; }
  async commit() { return null; }
  async renderComposition() { return { bytes: 0, filename: "none" }; }
  async bakeComposition() { return { bytes: 0, filename: "none" }; }
  async createComposition() { return { ok: false, message: "not used" }; }
  async copyComposition() { return { ok: false, message: "not used" }; }
  async setCompositionLibrary() { return { ok: false, message: "not used" }; }
  async nestComposition() { return { ok: false, message: "not used" }; }
  async deleteComposition() { return { ok: false, message: "not used" }; }
  async getGenerativeWorkspace() { return null; }
  async updateGenerativeRecipe() { return { ok: false, message: "not used" }; }
  async submitGeneration() { return { ok: false, message: "not used" }; }
  async pinGenerationTake() { return { ok: false, message: "not used" }; }
  async startGenerationFromTake() { return { ok: false, message: "not used" }; }
  async configureProvider() { return { ok: false, message: "not used" }; }
}

const clock: AnimationClock = { now: () => 0, request: () => 1, cancel: () => {} };

describe("StudioAgentApi", () => {
  it("inspects stable IDs, bindings, source revisions, asset locality and artifact staleness", async () => {
    const runtime = new AgentRuntime();
    const application = new StudioApplication(runtime, clock, "main");
    const agent = new StudioAgentApi(application);
    try {
      const first = await agent.inspect();
      const second = await agent.inspect();
      expect(second.revision).toBe(first.revision);
      expect(first.compositions[0]).toMatchObject({
        composition: { key: "main" },
        objects: [{ id: "clip", production: { contentHash: "sha256:asset" } }],
        animations: [{ id: "card-move", authority: "literal", bindings: { x: { kind: "keyframes" } } }],
        artifacts: [{ contentHash: "sha256:bake", status: "stale" }],
      });
      expect(first.compositions[0].sources.map((source) => source.file)).toEqual(["src/Main.html", "src/Motion.ts"]);
      expect(first.assets.map((asset) => [asset.id, asset.availability])).toEqual([["local", "local"], ["remote", "remote"]]);
      const check = await agent.check(first);
      expect(check.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "opaque-animation" }),
        expect.objectContaining({ code: "stale-artifact" }),
      ]));
    } finally {
      application.destroy();
    }
  });

  it("deduplicates identical diagnostics from repeated physical artifact records", async () => {
    const runtime = new AgentRuntime();
    runtime.cache.push({ ...runtime.cache[0] });
    const application = new StudioApplication(runtime, clock, "main");
    const agent = new StudioAgentApi(application);
    try {
      const check = await agent.check();
      const stale = check.diagnostics.filter((diagnostic) => diagnostic.code === "stale-artifact");
      expect(stale).toHaveLength(1);
      expect(stale[0].message).toContain("2 cached artifacts");
    } finally {
      application.destroy();
    }
  });

  it("refuses a stale base before mutation", async () => {
    const runtime = new AgentRuntime();
    const application = new StudioApplication(runtime, clock, "main");
    const agent = new StudioAgentApi(application);
    try {
      const inspected = await agent.inspect();
      runtime.sources.set("src/Main.html", "external edit");
      const result = await agent.execute({
        expectedRevision: inspected.revision,
        command: { type: "edit-placement", compositionKey: "main", itemId: "clip", patch: { from: 10, durationInFrames: 20 } },
      });
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining("changed") });
      expect(result.check.diagnostics[0]).toMatchObject({ code: "source-conflict", severity: "error" });
      expect(runtime.placementRequests).toHaveLength(0);
    } finally {
      application.destroy();
    }
  });

  it("uses the Studio front-trim kernel, returns a receipt, and shares undo history", async () => {
    const runtime = new AgentRuntime();
    const application = new StudioApplication(runtime, clock, "main");
    const agent = new StudioAgentApi(application);
    try {
      const inspected = await agent.inspect();
      const edited = await agent.execute({
        expectedRevision: inspected.revision,
        command: { type: "edit-placement", compositionKey: "main", itemId: "clip", patch: { from: 10, durationInFrames: 20 } },
      });
      expect(edited.ok).toBe(true);
      expect(edited.afterRevision).not.toBe(edited.beforeRevision);
      expect(edited.receipt).toMatchObject({ label: "Edit clip placement" });
      expect(runtime.placementRequests.map(({ field, value }) => [field, value])).toEqual([
        ["from", 10], ["durationInFrames", 20], ["trimStart", 2 + 10 / 30],
      ]);
      expect(application.history.state.get().undo).toHaveLength(1);
      expect(application.session.currentItems[0]).toMatchObject({ from: 10, durationInFrames: 20, content: { trimStart: 2 + 10 / 30 } });

      const undone = await agent.execute({ expectedRevision: edited.afterRevision, command: { type: "undo" } });
      expect(undone.ok).toBe(true);
      expect(runtime.replayed).toEqual(["undo"]);
      expect(application.history.state.get().redo).toHaveLength(1);
    } finally {
      application.destroy();
    }
  });

  it("reports an atomic-commit race as a file-level source conflict", async () => {
    const runtime = new AgentRuntime();
    const application = new StudioApplication(runtime, clock, "main");
    const agent = new StudioAgentApi(application);
    try {
      const inspected = await agent.inspect();
      runtime.nextPlacementConflict = true;
      const result = await agent.execute({
        expectedRevision: inspected.revision,
        command: { type: "edit-placement", compositionKey: "main", itemId: "clip", patch: { from: 4 } },
      });
      expect(result).toMatchObject({
        ok: false,
        conflicts: [{ file: "src/Main.html" }],
        check: { ok: false },
      });
      expect(result.check.diagnostics[0]).toMatchObject({ code: "source-conflict", file: "src/Main.html" });
    } finally {
      application.destroy();
    }
  });

  it("forwards exact integer frame snapshots", async () => {
    const runtime = new AgentRuntime();
    const application = new StudioApplication(runtime, clock, "main");
    const agent = new StudioAgentApi(application);
    try {
      await expect(agent.snapshot("main", 12.4)).resolves.toMatchObject({ frame: 12, contentHash: "sha256:png", mime: "image/png" });
      expect(runtime.snapshots).toEqual([{ key: "main", frame: 12 }]);
    } finally {
      application.destroy();
    }
  });
});
