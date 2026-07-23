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

  it("refuses draft mutations while a generation job is active", async () => {
    const composition = { key: "generate" } as CompositionDescriptor;
    const state = new ObservableValue({ currentKey: composition.key, compositions: [composition] } as StudioSessionState);
    const session = { state } as StudioSession;
    const updateGenerativeRecipe = vi.fn();
    const manager = new GenerativeManager(session, { updateGenerativeRecipe } as unknown as ProjectWorkspacePort);
    manager.state.update((current) => ({
      ...current,
      workspace: {
        jobs: [{ id: "job-1", status: "running" }],
      } as GenerativeWorkspaceSnapshot,
    }));

    expect(await manager.update({ prompt: "A different prompt" })).toBe(false);
    expect(updateGenerativeRecipe).not.toHaveBeenCalled();
    expect(manager.state.get().error).toBe("This recipe is locked until the generating take finishes.");
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
});
