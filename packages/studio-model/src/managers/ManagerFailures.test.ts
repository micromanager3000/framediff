import { describe, expect, it, vi } from "vitest";
import { StudioSession } from "../StudioSession";
import type {
  AnimationClock,
  CompositionDescriptor,
  CompositionRuntimePort,
  ProjectWorkspacePort,
} from "../types";
import { GitManager } from "./GitManager";
import { InspectorManager } from "./InspectorManager";
import { ProjectOperationsManager } from "./ProjectOperationsManager";
import { SourceManager } from "./SourceManager";

const composition: CompositionDescriptor = {
  key: "main",
  id: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 60,
  kind: "edit",
  outputKind: "video",
  file: "src/Main.ts",
};

const clock: AnimationClock = {
  now: () => 0,
  request: () => 1,
  cancel: () => {},
};

function runtime(overrides: Partial<CompositionRuntimePort> = {}): CompositionRuntimePort {
  return {
    getCompositions: () => [composition],
    subscribeCompositions: () => () => {},
    probe: async () => [],
    ...overrides,
  } as CompositionRuntimePort;
}

describe("manager adapter failures", () => {
  it("keeps the newest Git poll and recovers from rejected status and commit calls", async () => {
    let resolveFirst: ((dirty: string[]) => void) | undefined;
    let resolveSecond: ((dirty: string[]) => void) | undefined;
    const getGitStatus = vi.fn()
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveSecond = resolve; }));
    const workspace = {
      getGitStatus,
      commit: vi.fn(async () => { throw new Error("commit transport failed"); }),
    } as unknown as ProjectWorkspacePort;
    const manager = new GitManager(workspace);

    const first = manager.refresh();
    const second = manager.refresh();
    resolveSecond?.(["newer.ts"]);
    await second;
    resolveFirst?.(["stale.ts"]);
    await first;
    expect(manager.state.get()).toMatchObject({ dirty: ["newer.ts"], loading: false });

    getGitStatus.mockRejectedValueOnce(new Error("status transport failed"));
    await manager.refresh();
    expect(manager.state.get()).toMatchObject({ loading: false, error: "status transport failed" });

    expect(await manager.commit("Checkpoint")).toBe(false);
    expect(manager.state.get()).toMatchObject({ committing: false, error: "commit transport failed" });
  });

  it("turns a rejected source read into a stable error state", async () => {
    const session = new StudioSession(runtime(), clock, "main");
    const manager = new SourceManager(session, {
      readSource: async () => { throw new Error("source transport failed"); },
    } as unknown as ProjectWorkspacePort);

    manager.start();
    await vi.waitFor(() => expect(manager.state.get()).toMatchObject({
      file: "src/Main.ts",
      loading: false,
      error: "source transport failed",
    }));
    manager.destroy();
  });

  it("does not show the previous composition's source under a new filename", async () => {
    const second = { ...composition, key: "second", id: "Second", file: "src/Second.ts" };
    let resolveSecond: ((text: string) => void) | undefined;
    const studioRuntime = runtime({
      getCompositions: () => [composition, second],
    });
    const session = new StudioSession(studioRuntime, clock, "main");
    const manager = new SourceManager(session, {
      readSource: vi.fn((file: string) => file === composition.file
        ? Promise.resolve("export const main = true;")
        : new Promise<string>((resolve) => { resolveSecond = resolve; })),
    } as unknown as ProjectWorkspacePort);

    manager.start();
    await vi.waitFor(() => expect(manager.state.get().text).toContain("main"));
    session.navigate("second");
    expect(manager.state.get()).toMatchObject({ file: "src/Second.ts", text: "", loading: true });
    resolveSecond?.("export const second = true;");
    await vi.waitFor(() => expect(manager.state.get()).toMatchObject({
      file: "src/Second.ts",
      text: "export const second = true;",
      loading: false,
    }));
    manager.destroy();
  });

  it("restores Inspector editing after a rejected field write", async () => {
    const studioRuntime = runtime({
      inspectItem: async (compositionKey, itemId) => ({
        compositionKey,
        itemId,
        sections: [{
          id: "properties",
          title: "PROPERTIES",
          fields: [{ id: "title", label: "Title", text: "Before", editable: true }],
        }],
      }),
      editInspectorField: async () => { throw new Error("edit transport failed"); },
    });
    const session = new StudioSession(studioRuntime, clock, "main");
    const manager = new InspectorManager(session, studioRuntime);

    manager.start();
    await vi.waitFor(() => expect(manager.state.get().details).not.toBeNull());
    expect(await manager.edit("title", "After")).toBe(false);
    expect(manager.state.get()).toMatchObject({ editing: false, error: "edit transport failed" });
    manager.destroy();
  });

  it("restores the shared session after a rejected timeline edit", async () => {
    const studioRuntime = runtime({
      probe: async () => [{
        id: "shot",
        from: 0,
        durationInFrames: 60,
        content: { type: "layers", label: "Shot" },
        order: 0,
        origin: "sequence",
        editable: { from: true, duration: false },
      }],
      editPlacement: async () => { throw new Error("placement transport failed"); },
    });
    const session = new StudioSession(studioRuntime, clock, "main");

    await session.start();
    session.selectItem("shot");
    expect(await session.editSelected("from", 12)).toBe(false);
    expect(session.state.get()).toMatchObject({ editing: false, error: "placement transport failed" });
    session.destroy();
  });

  it("restores project-operation controls after a rejected mutation", async () => {
    const session = new StudioSession(runtime(), clock, "main");
    const manager = new ProjectOperationsManager(session, {
      deleteComposition: async () => { throw new Error("delete transport failed"); },
    } as unknown as ProjectWorkspacePort);

    expect(await manager.delete("main")).toBe(false);
    expect(manager.state.get()).toMatchObject({ busy: false, error: "delete transport failed" });
  });
});
