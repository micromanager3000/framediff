import { describe, expect, it } from "vitest";
import type {
  CompositionRuntimePort,
  ProjectEditListener,
  ProjectEditReceipt,
  ProjectEditResult,
} from "../types";
import { HistoryManager, mergeGroupedReceipts } from "./HistoryManager";

const snapshot = (file: string, text: string) => ({ file, text, hash: `sha256:${text}` });
const receipt = (id: string, before: string, after: string, groupId?: string): ProjectEditReceipt => ({
  id,
  label: `Edit ${id}`,
  ...(groupId ? { groupId } : {}),
  before: [snapshot("Comp.html", before)],
  after: [snapshot("Comp.html", after)],
});

class HistoryRuntime {
  public listeners = new Set<ProjectEditListener>();
  public replays: { receipt: ProjectEditReceipt; direction: "undo" | "redo" }[] = [];
  public nextResult: ProjectEditResult = { ok: true };

  public subscribeProjectEdits(listener: ProjectEditListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(value: ProjectEditReceipt) {
    for (const listener of this.listeners) listener(value);
  }

  public async replayProjectEdit(value: ProjectEditReceipt, direction: "undo" | "redo") {
    this.replays.push({ receipt: value, direction });
    return this.nextResult;
  }
}

describe("HistoryManager", () => {
  it("moves exact receipts between undo and redo stacks", async () => {
    const runtime = new HistoryRuntime();
    const manager = new HistoryManager(runtime as unknown as CompositionRuntimePort);
    manager.start();
    const edit = receipt("one", "before", "after");
    runtime.emit(edit);

    expect(manager.state.get().undo).toEqual([edit]);
    expect(await manager.undo()).toBe(true);
    expect(runtime.replays).toEqual([{ receipt: edit, direction: "undo" }]);
    expect(manager.state.get()).toMatchObject({ undo: [], redo: [edit], applying: false, error: null });

    expect(await manager.redo()).toBe(true);
    expect(runtime.replays.at(-1)).toEqual({ receipt: edit, direction: "redo" });
    expect(manager.state.get()).toMatchObject({ undo: [edit], redo: [], applying: false, error: null });
  });

  it("coalesces continuous groups from the first before to the latest after", () => {
    const first = receipt("first", "a", "b", "slider:opacity");
    const second = receipt("second", "b", "c", "slider:opacity");
    expect(mergeGroupedReceipts(first, second)).toMatchObject({
      id: "first",
      groupId: "slider:opacity",
      before: [snapshot("Comp.html", "a")],
      after: [snapshot("Comp.html", "c")],
    });
  });

  it("keeps history intact and reports source conflicts", async () => {
    const runtime = new HistoryRuntime();
    const manager = new HistoryManager(runtime as unknown as CompositionRuntimePort);
    manager.start();
    const edit = receipt("one", "before", "after");
    runtime.emit(edit);
    runtime.nextResult = {
      ok: false,
      message: "Source changed since it was inspected.",
      conflicts: [{ file: "Comp.html", expectedHash: "sha256:after", actualHash: "sha256:external" }],
    };

    expect(await manager.undo()).toBe(false);
    expect(manager.state.get().undo).toEqual([edit]);
    expect(manager.state.get().redo).toEqual([]);
    expect(manager.state.get().error).toContain("Source changed");
  });

  it("clears redo when a new edit arrives after undo", async () => {
    const runtime = new HistoryRuntime();
    const manager = new HistoryManager(runtime as unknown as CompositionRuntimePort);
    manager.start();
    runtime.emit(receipt("one", "a", "b"));
    await manager.undo();
    runtime.emit(receipt("two", "a", "c"));
    expect(manager.state.get().redo).toEqual([]);
    expect(manager.state.get().undo.map((entry) => entry.id)).toEqual(["two"]);
  });
});
