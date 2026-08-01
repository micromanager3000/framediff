import { describe, expect, it, vi } from "vitest";
import {
  canonicalProcessingRecipe,
  fingerprintProcessingRecipe,
  ProcessingManager,
  resolvePinnedProcessingChannel,
  validateProcessingArtifactManifest,
  validateProcessingRecipe,
  type ProcessingRecipe,
  type ProcessingOperationResult,
  type ProcessingWorkspacePort,
  type ProcessingWorkspaceSnapshot,
} from "./processing";

const recipe = (): ProcessingRecipe => ({
  version: 1,
  kind: "processing",
  id: "depth-v2",
  inputs: [{ name: "source", contentHash: "sha256:input", mime: "video/mp4" }],
  parameters: { normalize: true },
  provenance: { processor: "depth", model: "depth-anything-v2", modelRevision: "weights-1", runtime: "onnx", runtimeRevision: "runtime-1" },
});

const manifest = async () => ({
  version: 1 as const,
  kind: "processing-artifact" as const,
  recipeFingerprint: await fingerprintProcessingRecipe(recipe()),
  inputs: recipe().inputs,
  provenance: recipe().provenance,
  channels: {
    depth: { name: "depth", contentHash: "sha256:depth", mime: "application/octet-stream", bytes: 8, dtype: "float32", shape: [2, 1] },
    preview: { name: "preview", contentHash: "sha256:preview", mime: "image/png", bytes: 4, dimensions: { width: 2, height: 1 }, timing: { fps: 30, frameCount: 1 } },
  },
});

const workspace = async (artifact: Awaited<ReturnType<typeof manifest>>): Promise<ProcessingWorkspaceSnapshot> => ({
  compositionKey: "processing",
  recipe: recipe(),
  artifact,
  pinnedRecipeFingerprint: artifact.recipeFingerprint,
  recipeFingerprint: artifact.recipeFingerprint,
  status: "current",
});

describe("processing recipe and named-channel contracts", () => {
  it("round-trips a valid recipe and changes its fingerprint when inputs or provenance change", async () => {
    expect(validateProcessingRecipe(recipe())).toEqual([]);
    const multiInput = {
      ...recipe(),
      inputs: [
        ...recipe().inputs,
        { name: "mask", contentHash: "sha256:mask", mime: "image/png" },
      ],
    };
    expect(canonicalProcessingRecipe({ ...multiInput, inputs: [...multiInput.inputs].reverse() })).toBe(canonicalProcessingRecipe(multiInput));
    expect(await fingerprintProcessingRecipe(recipe())).not.toBe(await fingerprintProcessingRecipe({ ...recipe(), provenance: { ...recipe().provenance, modelRevision: "weights-2" } }));
    expect(validateProcessingRecipe({ ...recipe(), version: 2 })).toContain("recipe.version must be 1");
  });

  it("rejects malformed artifacts and resolves only pinned, current named channels", async () => {
    const valid = await manifest();
    expect(validateProcessingArtifactManifest(valid)).toEqual([]);
    expect(validateProcessingArtifactManifest({ ...valid, channels: { preview: { ...valid.channels.preview, dtype: undefined, timing: undefined } } })).toContain("artifact.channels.preview must describe tensor dtype/shape or media timing");
    const current = await workspace(valid);
    expect(resolvePinnedProcessingChannel(current, "depth")).toMatchObject({ ok: true, channel: { contentHash: "sha256:depth" } });
    expect(resolvePinnedProcessingChannel({ ...current, status: "stale" }, "depth").message).toContain("workspace is stale");
    expect(resolvePinnedProcessingChannel({ ...current, status: "failed" }, "depth").message).toContain("workspace is failed");
    expect(resolvePinnedProcessingChannel({ ...current, pinnedRecipeFingerprint: "sha256:old" }, "depth").ok).toBe(false);
    expect(resolvePinnedProcessingChannel({ ...current, recipeFingerprint: "sha256:new" }, "depth").message).toContain("recipe changed");
    expect(resolvePinnedProcessingChannel({ ...current, artifact: { ...valid, inputs: [{ name: "source", contentHash: "sha256:other" }] } }, "depth").message).toContain("inputs are stale");
    expect(resolvePinnedProcessingChannel(current, "matte").message).toContain("no channel named");
  });

  it("restores busy state on run failure and ignores stale refresh results", async () => {
    let resolveFirst: ((value: ProcessingWorkspaceSnapshot) => void) | undefined;
    const first = new Promise<ProcessingWorkspaceSnapshot>((resolve) => { resolveFirst = resolve; });
    const current = await manifest();
    const port: ProcessingWorkspacePort = {
      getProcessingWorkspace: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce(await workspace(current)),
      runProcessing: vi.fn(async () => { throw new Error("worker unavailable"); }),
      pinProcessingArtifact: vi.fn(),
    };
    const manager = new ProcessingManager(() => "processing", port);
    const stale = manager.refresh();
    await manager.refresh();
    resolveFirst?.(await workspace(current));
    await stale;
    expect(manager.state.get().workspace?.artifact?.recipeFingerprint).toBe(current.recipeFingerprint);
    expect(await manager.run()).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, error: "worker unavailable" });
  });

  it("ignores a run result after the selected composition changes", async () => {
    let selected = "processing-a";
    let finish!: (result: { ok: boolean; message: string }) => void;
    const port: ProcessingWorkspacePort = {
      getProcessingWorkspace: vi.fn(),
      runProcessing: vi.fn(() => new Promise<ProcessingOperationResult>((resolve) => { finish = resolve; })),
      pinProcessingArtifact: vi.fn(),
    };
    const manager = new ProcessingManager(() => selected, port);
    const run = manager.run();
    selected = "processing-b";
    finish({ ok: true, message: "completed old selection" });
    expect(await run).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, workspace: null, message: null });
  });

  it("restores busy state when pin rejects and does not hide the adapter error", async () => {
    const current = await manifest();
    const pinProcessingArtifact = vi.fn(async () => { throw new Error("pin conflict"); });
    const port: ProcessingWorkspacePort = {
      getProcessingWorkspace: vi.fn(),
      runProcessing: vi.fn(),
      pinProcessingArtifact,
    };
    const manager = new ProcessingManager(() => "processing", port);
    manager.state.update((state) => ({ ...state, workspace: awaitWorkspace(current) }));
    expect(await manager.pin()).toBe(false);
    expect(pinProcessingArtifact).toHaveBeenCalledWith("processing", current.recipeFingerprint);
    expect(manager.state.get()).toMatchObject({ busy: false, error: "pin conflict" });
  });

  it("ignores a pin result after the selected composition changes", async () => {
    let selected = "processing-a";
    let finish!: (result: ProcessingOperationResult) => void;
    const current = await manifest();
    const port: ProcessingWorkspacePort = {
      getProcessingWorkspace: vi.fn(),
      runProcessing: vi.fn(),
      pinProcessingArtifact: vi.fn(() => new Promise<ProcessingOperationResult>((resolve) => { finish = resolve; })),
    };
    const manager = new ProcessingManager(() => selected, port);
    manager.state.update((state) => ({ ...state, workspace: awaitWorkspace(current) }));
    const pin = manager.pin();
    selected = "processing-b";
    finish({ ok: true, message: "pinned old selection" });
    expect(await pin).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, workspace: null, message: null });
  });
});

function awaitWorkspace(artifact: Awaited<ReturnType<typeof manifest>>): ProcessingWorkspaceSnapshot {
  return {
    compositionKey: "processing",
    recipe: recipe(),
    artifact,
    pinnedRecipeFingerprint: artifact.recipeFingerprint,
    recipeFingerprint: artifact.recipeFingerprint,
    status: "current",
  };
}
