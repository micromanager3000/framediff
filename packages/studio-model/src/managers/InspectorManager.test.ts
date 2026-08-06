import { describe, expect, it, vi } from "vitest";
import { StudioSession } from "../StudioSession";
import type { AnimationClock, CompositionDescriptor, CompositionRuntimePort, TimelineItemSnapshot } from "../types";
import { InspectorManager } from "./InspectorManager";

const composition: CompositionDescriptor = {
  key: "main",
  id: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 60,
  definitionVersion: 1,
  type: "html",
  kind: "edit",
  outputKind: "video",
};

const shot: TimelineItemSnapshot = {
  id: "shot",
  from: 0,
  durationInFrames: 60,
  content: { type: "layers", label: "Shot" },
  order: 0,
  origin: "sequence",
};

const clock: AnimationClock = {
  now: () => 0,
  request: () => 1,
  cancel: () => {},
};

describe("InspectorManager", () => {
  it("loads composition-level controls when nothing is selected", async () => {
    const inspectItem = vi.fn(async (compositionKey: string, itemId: string) => ({
      compositionKey,
      itemId,
      sections: [{ id: "composition", title: "COMPOSITION PROPERTIES", fields: [] }],
    }));
    const runtime = {
      getCompositions: () => [composition],
      subscribeCompositions: () => () => {},
      probe: async () => [shot],
      inspectItem,
    } as unknown as CompositionRuntimePort;
    const session = new StudioSession(runtime, clock, "main");
    const manager = new InspectorManager(session, runtime);
    manager.start();
    await session.start();

    await vi.waitFor(() => expect(manager.state.get().details?.itemId).toBe("Main"));
    expect(inspectItem).toHaveBeenCalledWith("main", "Main");
    manager.destroy();
    session.destroy();
  });

  it("reloads selected source-backed details across a probe boundary", async () => {
    let sourceValue = "before";
    const runtime = {
      getCompositions: () => [composition],
      subscribeCompositions: () => () => {},
      probe: async () => [shot],
      inspectItem: async (compositionKey: string, itemId: string) => ({
        compositionKey,
        itemId,
        sections: [{ id: "properties", title: "PROPERTIES", fields: [{ id: "text", label: "text", text: sourceValue, editable: true }] }],
      }),
    } as unknown as CompositionRuntimePort;
    const session = new StudioSession(runtime, clock, "main");
    const manager = new InspectorManager(session, runtime);
    manager.start();
    await session.start();
    session.selectItem("shot");
    await vi.waitFor(() => expect(manager.state.get().details?.sections[0].fields[0].text).toBe("before"));

    sourceValue = "after undo";
    await session.refresh();

    await vi.waitFor(() => expect(manager.state.get().details?.sections[0].fields[0].text).toBe("after undo"));
    manager.destroy();
    session.destroy();
  });

  it("commits a camera gizmo gesture as one multi-field source transaction", async () => {
    const editInspectorFields = vi.fn(async () => ({ ok: true }));
    const runtime = {
      getCompositions: () => [composition],
      subscribeCompositions: () => () => {},
      probe: async () => [shot],
      inspectItem: async (compositionKey: string, itemId: string) => ({
        compositionKey,
        itemId,
        sections: [{
          id: "camera",
          title: "CAMERA",
          fields: [
            { id: "cameraX", label: "X", value: 1, editable: true },
            { id: "cameraZ", label: "Z", value: 2, editable: true },
          ],
        }],
      }),
      editInspectorFields,
    } as unknown as CompositionRuntimePort;
    const session = new StudioSession(runtime, clock, "main");
    const manager = new InspectorManager(session, runtime);
    manager.start();
    await session.start();
    session.selectItem("shot");
    await vi.waitFor(() => expect(manager.state.get().details?.itemId).toBe("shot"));

    const edits = [{ fieldId: "cameraX", value: 3 }, { fieldId: "cameraZ", value: 4 }];
    expect(await manager.editMany(edits, { label: "Move start camera", groupId: "gesture-1" })).toBe(true);

    expect(editInspectorFields).toHaveBeenCalledOnce();
    expect(editInspectorFields).toHaveBeenCalledWith({
      compositionKey: "main",
      itemId: "shot",
      edits,
      label: "Move start camera",
      groupId: "gesture-1",
    });
    expect(manager.state.get().details?.sections[0].fields.map((field) => field.value)).toEqual([3, 4]);
    manager.destroy();
    session.destroy();
  });

  it("does not let a pre-edit Inspector load overwrite an accepted optimistic gesture", async () => {
    let deferLoad = false;
    let resolveStaleLoad: ((details: { compositionKey: string; itemId: string; sections: Array<{ id: string; title: string; fields: Array<{ id: string; label: string; value: number; editable: boolean }> }> }) => void) | undefined;
    let resolveEdit: ((result: { ok: true }) => void) | undefined;
    const details = (value: number) => ({
      compositionKey: "main",
      itemId: "shot",
      sections: [{ id: "camera", title: "CAMERA", fields: [{ id: "cameraX", label: "X", value, editable: true }] }],
    });
    const runtime = {
      getCompositions: () => [composition],
      subscribeCompositions: () => () => {},
      probe: async () => [shot],
      inspectItem: async () => deferLoad
        ? new Promise<ReturnType<typeof details>>((resolve) => { resolveStaleLoad = resolve; })
        : details(1),
      editInspectorFields: async () => new Promise<{ ok: true }>((resolve) => { resolveEdit = resolve; }),
    } as unknown as CompositionRuntimePort;
    const session = new StudioSession(runtime, clock, "main");
    const manager = new InspectorManager(session, runtime);
    manager.start();
    await session.start();
    session.selectItem("shot");
    await vi.waitFor(() => expect(manager.state.get().details?.itemId).toBe("shot"));

    const edit = manager.editMany([{ fieldId: "cameraX", value: 3 }]);
    deferLoad = true;
    const staleLoad = manager.load();
    await vi.waitFor(() => expect(resolveStaleLoad).toBeTypeOf("function"));
    resolveEdit?.({ ok: true });
    expect(await edit).toBe(true);
    expect(manager.state.get().details?.sections[0].fields[0].value).toBe(3);

    resolveStaleLoad?.(details(1));
    await staleLoad;
    expect(manager.state.get().details?.sections[0].fields[0].value).toBe(3);
    manager.destroy();
    session.destroy();
  });
});
