import { describe, expect, it } from "vitest";
import { compositionByReference } from "./compositionRef";
import type { CompositionDescriptor } from "./types";

const compositions: CompositionDescriptor[] = [
  {
    key: "lighthouse-dialogue",
    id: "lighthouseDialogue",
    width: 720,
    height: 1280,
    fps: 30,
    durationInFrames: 420,
    definitionVersion: 1,
    type: "generative",
    kind: "scene",
    outputKind: "video",
  },
];

describe("compositionByReference", () => {
  it("resolves both stable registry keys and legacy display ids", () => {
    expect(compositionByReference(compositions, "lighthouse-dialogue")?.id).toBe("lighthouseDialogue");
    expect(compositionByReference(compositions, "lighthouseDialogue")?.key).toBe("lighthouse-dialogue");
    expect(compositionByReference(compositions, "missing")).toBeUndefined();
  });
});
