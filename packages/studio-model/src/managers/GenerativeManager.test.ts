import { describe, expect, it, vi } from "vitest";
import { ObservableValue } from "../observable";
import type { CompositionDescriptor, ProjectWorkspacePort, StudioSessionState } from "../types";
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
});
