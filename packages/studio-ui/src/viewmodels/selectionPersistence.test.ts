import { describe, expect, it, vi } from "vitest";
import type { StudioSession } from "@framediff/studio-model";
import { restoreStudioSelection, serializeStudioSelection } from "./selectionPersistence";

function session() {
  const state = { currentKey: "main" };
  return {
    state: { get: () => state },
    currentItems: [{ id: "canvas" }, { id: "clip" }],
    currentAnimations: [{ id: "title-move" }],
    selectItem: vi.fn(),
    selectElement: vi.fn(),
    selectAnimation: vi.fn(),
  } as unknown as StudioSession;
}

describe("Studio selection persistence", () => {
  it("round-trips an element's stable identity and owning timeline row", () => {
    const stored = serializeStudioSelection({
      selection: { compositionKey: "main", objectId: "hero-title", kind: "element" },
      selectedItemId: "canvas",
    });
    const target = session();

    expect(restoreStudioSelection(target, stored)).toBe(true);
    expect(target.selectElement).toHaveBeenCalledWith("hero-title", "canvas");
    expect(target.selectItem).not.toHaveBeenCalled();
  });

  it("restores animation selections without pretending they are clips", () => {
    const stored = serializeStudioSelection({
      selection: { compositionKey: "main", objectId: "title-move", kind: "animation" },
      selectedItemId: null,
    });
    const target = session();

    expect(restoreStudioSelection(target, stored)).toBe(true);
    expect(target.selectAnimation).toHaveBeenCalledWith("title-move");
    expect(target.selectItem).not.toHaveBeenCalled();
  });

  it("accepts the legacy bare clip ID and refuses stale composition or animation IDs", () => {
    const target = session();
    expect(restoreStudioSelection(target, "clip")).toBe(true);
    expect(target.selectItem).toHaveBeenCalledWith("clip");

    expect(restoreStudioSelection(target, JSON.stringify({
      version: 1,
      selection: { compositionKey: "other", objectId: "clip", kind: "clip" },
      selectedItemId: "clip",
    }))).toBe(false);
    expect(restoreStudioSelection(target, JSON.stringify({
      version: 1,
      selection: { compositionKey: "main", objectId: "missing", kind: "animation" },
      selectedItemId: null,
    }))).toBe(false);
  });
});
