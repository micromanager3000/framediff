import { describe, expect, it } from "vitest";
import { canNestComposition } from "./nesting";
import type { CompositionDescriptor, TimelineItemSnapshot } from "./types";

const comp = (key: string, id: string, extra: Partial<CompositionDescriptor> = {}): CompositionDescriptor => ({
  key, id, width: 1920, height: 1080, fps: 30, durationInFrames: 120, kind: "edit", outputKind: "video", ...extra,
});

const nested = (compId: string): TimelineItemSnapshot => ({
  id: `it:${compId}`,
  from: 0,
  durationInFrames: 60,
  name: compId,
  content: { type: "nested", compId, trimStart: 0 },
  order: 0,
  origin: "sequence",
});

const state = {
  compositions: [
    comp("main", "Main"),
    comp("title", "Title"),
    comp("shot", "Shot", { kind: "generate" }),
    comp("free", "Free"),
  ],
  // main nests title; title nests shot
  timelineByComposition: {
    main: [nested("Title")],
    title: [nested("Shot")],
  },
};

describe("canNestComposition", () => {
  it("allows an unrelated comp into a stack", () => {
    expect(canNestComposition(state, "free", "main").ok).toBe(true);
  });

  it("allows the same comp to nest twice", () => {
    // main already nests title — a second instance is legal
    expect(canNestComposition(state, "title", "main").ok).toBe(true);
  });

  it("refuses self-nesting", () => {
    expect(canNestComposition(state, "main", "main")).toEqual({ ok: false, why: "Main can't nest itself" });
  });

  it("refuses a cycle, transitively", () => {
    expect(canNestComposition(state, "main", "title").ok).toBe(false);
    // shot is nested two levels below main
    expect(canNestComposition(state, "main", "shot").ok).toBe(false);
  });

  it("refuses generative targets — recipes are not stacks", () => {
    expect(canNestComposition(state, "free", "shot").ok).toBe(false);
  });

  it("refuses unknown comps", () => {
    expect(canNestComposition(state, "free", "gone").ok).toBe(false);
  });
});
