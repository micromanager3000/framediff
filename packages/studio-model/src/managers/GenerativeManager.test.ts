import { describe, expect, it, vi } from "vitest";
import { ObservableValue } from "../observable";
import type { CompositionDescriptor, GenerativeWorkspaceSnapshot, ProjectWorkspacePort, StudioSessionState } from "../types";
import type { StudioSession } from "../StudioSession";
import { GenerativeManager } from "./GenerativeManager";

describe("GenerativeManager", () => {
  it("refreshes the current recipe when HMR replaces the composition registry", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const getGenerativeWorkspace = vi.fn(async () => null);
    const manager = new GenerativeManager(session, { getGenerativeWorkspace } as unknown as ProjectWorkspacePort);

    manager.start();
    await vi.waitFor(() => expect(getGenerativeWorkspace).toHaveBeenCalledTimes(1));

    state.update((current) => ({ ...current, frame: 1 }));
    await Promise.resolve();
    expect(getGenerativeWorkspace).toHaveBeenCalledTimes(1);

    state.update((current) => ({ ...current, compositions: [...current.compositions] }));
    await vi.waitFor(() => expect(getGenerativeWorkspace).toHaveBeenCalledTimes(2));
    manager.destroy();
  });

  it("keeps draft mutations available while a generation job is active", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const updateGenerativeRecipe = vi.fn(async () => ({ ok: true, message: "Updated" }));
    const manager = new GenerativeManager(session, { updateGenerativeRecipe } as unknown as ProjectWorkspacePort);
    manager.state.update((current) => ({
      ...current,
      workspace: {
        jobs: [{ id: "job-1", status: "running" }],
      } as GenerativeWorkspaceSnapshot,
    }));

    expect(await manager.update({ prompt: "A different prompt" })).toBe(true);
    expect(updateGenerativeRecipe).toHaveBeenCalledOnce();
  });

  it("marks the take as submitting before the provider returns a job", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    let finishSubmit!: (result: { ok: boolean; message: string }) => void;
    const submitGeneration = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => {
      finishSubmit = resolve;
    }));
    const manager = new GenerativeManager(session, {
      submitGeneration,
      getGenerativeWorkspace: vi.fn(async () => null),
    } as unknown as ProjectWorkspacePort);
    manager.state.update((current) => ({
      ...current,
      workspace: { jobs: [], takes: [] } as unknown as GenerativeWorkspaceSnapshot,
    }));

    const pending = manager.generate();
    expect(manager.state.get().submitting).toBe(true);
    finishSubmit({ ok: true, message: "Submitted" });
    expect(await pending).toBe(true);
    expect(manager.state.get().submitting).toBe(false);
  });

  it("replaces the submission notice once the job is visible", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const workspace = {
      jobs: [{ id: "failed-job", status: "failed", error: "Provider rejected the request." }],
      takes: [],
    } as unknown as GenerativeWorkspaceSnapshot;
    const manager = new GenerativeManager(session, {
      getGenerativeWorkspace: vi.fn(async () => workspace),
    } as unknown as ProjectWorkspacePort);
    manager.state.update((current) => ({
      ...current,
      message: "Submitted generation failed-jo…",
    }));

    await manager.refresh();

    expect(manager.state.get().message).toBeNull();
    expect(manager.state.get().workspace).toBe(workspace);
  });

  it("refreshes a persisted failed attempt after submission is rejected", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const failedWorkspace = {
      jobs: [{ id: "failed-job", status: "failed", take: 1, error: "Provider rejected the request." }],
      takes: [],
    } as unknown as GenerativeWorkspaceSnapshot;
    const getGenerativeWorkspace = vi.fn(async () => failedWorkspace);
    const manager = new GenerativeManager(session, {
      submitGeneration: vi.fn(async () => ({ ok: false, message: "Provider rejected the request." })),
      getGenerativeWorkspace,
    } as unknown as ProjectWorkspacePort);
    manager.state.update((current) => ({
      ...current,
      workspace: { jobs: [], takes: [] } as unknown as GenerativeWorkspaceSnapshot,
    }));

    expect(await manager.generate()).toBe(false);

    expect(getGenerativeWorkspace).toHaveBeenCalledOnce();
    expect(manager.state.get().workspace).toBe(failedWorkspace);
    expect(manager.state.get().error).toBe("Provider rejected the request.");
  });

  it("does not change delivery pin as a polling side effect", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const unpinned = {
      recipeId: "generated",
      pinnedTake: 0,
      jobs: [{ id: "job-1", status: "done", take: 1 }],
      takes: [{ take: 1 }],
    } as unknown as GenerativeWorkspaceSnapshot;
    const getGenerativeWorkspace = vi.fn().mockResolvedValue(unpinned);
    const pinGenerationTake = vi.fn(async () => ({ ok: true, message: "Pinned take 1." }));
    const manager = new GenerativeManager(session, {
      getGenerativeWorkspace,
      pinGenerationTake,
    } as unknown as ProjectWorkspacePort);

    await manager.refresh();

    expect(pinGenerationTake).not.toHaveBeenCalled();
    expect(manager.state.get().workspace?.pinnedTake).toBe(0);
  });

  it("does not replace an existing pin when a generated take completes", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const workspace = {
      recipeId: "generated",
      pinnedTake: 1,
      jobs: [{ id: "job-2", status: "done", take: 2 }],
      takes: [{ take: 1 }, { take: 2 }],
    } as unknown as GenerativeWorkspaceSnapshot;
    const pinGenerationTake = vi.fn();
    const manager = new GenerativeManager(session, {
      getGenerativeWorkspace: vi.fn(async () => workspace),
      pinGenerationTake,
    } as unknown as ProjectWorkspacePort);

    await manager.refresh();

    expect(pinGenerationTake).not.toHaveBeenCalled();
    expect(manager.state.get().workspace).toBe(workspace);
  });

  it("does not auto-pin historical jobs that predate the default-pin intent", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const workspace = {
      recipeId: "generated",
      pinnedTake: 0,
      jobs: [{ id: "legacy-job", status: "done", take: 1 }],
      takes: [{ take: 1 }],
    } as unknown as GenerativeWorkspaceSnapshot;
    const pinGenerationTake = vi.fn();
    const manager = new GenerativeManager(session, {
      getGenerativeWorkspace: vi.fn(async () => workspace),
      pinGenerationTake,
    } as unknown as ProjectWorkspacePort);

    await manager.refresh();

    expect(pinGenerationTake).not.toHaveBeenCalled();
  });

  it("cleans up busy and submitting after rejected adapter operations", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const manager = new GenerativeManager(session, {
      updateGenerativeRecipe: vi.fn(async () => { throw new Error("bridge unavailable"); }),
      submitGeneration: vi.fn(async () => { throw new Error("provider unavailable"); }),
    } as unknown as ProjectWorkspacePort);

    expect(await manager.update({ prompt: "retry me" })).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, submitting: false, error: "bridge unavailable" });
    expect(await manager.generate()).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, submitting: false, error: "provider unavailable" });
  });

  it("preserves the active workspace when a poll rejects", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const workspace = { status: "running", jobs: [{ id: "job-1", status: "running" }] } as unknown as GenerativeWorkspaceSnapshot;
    const getGenerativeWorkspace = vi.fn()
      .mockResolvedValueOnce(workspace)
      .mockRejectedValueOnce(new Error("temporary poll failure"));
    const manager = new GenerativeManager(session, { getGenerativeWorkspace } as unknown as ProjectWorkspacePort);

    await manager.refresh();
    await manager.refresh();

    expect(manager.state.get().workspace).toBe(workspace);
    expect(manager.state.get().error).toBe("temporary poll failure");
  });

  it("ignores an out-of-order response after composition navigation", async () => {
    const first = { key: "first" } as CompositionDescriptor;
    const second = { key: "second" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: first.key, compositions: [first, second] } as StudioSessionState);
    const session = { state } as StudioSession;
    let resolveFirst!: (workspace: GenerativeWorkspaceSnapshot) => void;
    const getGenerativeWorkspace = vi.fn((key: string) => key === "first"
      ? new Promise<GenerativeWorkspaceSnapshot>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ compositionKey: "second" } as GenerativeWorkspaceSnapshot));
    const manager = new GenerativeManager(session, { getGenerativeWorkspace } as unknown as ProjectWorkspacePort);

    manager.start();
    state.update((current) => ({ ...current, currentKey: second.key }));
    resolveFirst({ compositionKey: "first" } as GenerativeWorkspaceSnapshot);

    await vi.waitFor(() => expect(manager.state.get().workspace?.compositionKey).toBe("second"));
    expect(manager.state.get().workspace?.compositionKey).not.toBe("first");
    manager.destroy();
  });

  it("ignores a delayed mutation rejection after composition navigation and clears transient guards", async () => {
    const first = { key: "first" } as CompositionDescriptor;
    const second = { key: "second" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: first.key, compositions: [first, second] } as StudioSessionState);
    const session = { state } as StudioSession;
    let rejectFirst!: (error: Error) => void;
    const updateGenerativeRecipe = vi.fn((key: string) => key === first.key
      ? new Promise<{ ok: boolean; message: string }>((_resolve, reject) => { rejectFirst = reject; })
      : Promise.resolve({ ok: true, message: "Updated second" }));
    const getGenerativeWorkspace = vi.fn(async () => null);
    const manager = new GenerativeManager(session, {
      getGenerativeWorkspace,
      updateGenerativeRecipe,
    } as unknown as ProjectWorkspacePort);

    manager.start();
    await vi.waitFor(() => expect(getGenerativeWorkspace).toHaveBeenCalledOnce());
    const firstUpdate = manager.update({ prompt: "old composition" });
    expect(manager.state.get().busy).toBe(true);

    state.update((current) => ({ ...current, currentKey: second.key }));
    expect(manager.state.get()).toMatchObject({ busy: false, submitting: false, workspace: null });
    rejectFirst(new Error("old bridge failure"));

    expect(await firstUpdate).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, submitting: false, error: null });
    expect(await manager.update({ prompt: "new composition" })).toBe(true);
    expect(updateGenerativeRecipe).toHaveBeenNthCalledWith(2, second.key, { prompt: "new composition" });
    manager.destroy();
  });
});
