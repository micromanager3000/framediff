import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
  StudioSession,
  type AnimationClock,
  type CompositionDescriptor,
  type CompositionRuntimePort,
  type TimelineItemSnapshot,
} from "@framediff/studio-model";
import { compositionMatchesSearch, CompositionRailViewModel } from "./CompositionRail.ViewModel";

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

const compositions = [
  comp("main", "Main"),
  comp("title", "Title"),
  comp("lib", "LibComp", { library: true }),
  comp("free", "Free"),
];
const timelines: Record<string, TimelineItemSnapshot[]> = {
  main: [nested("Title"), nested("LibComp")],
};

const runtime = {
  getCompositions: () => compositions,
  subscribeCompositions: () => () => {},
  probe: async (key: string) => timelines[key] ?? [],
} as unknown as CompositionRuntimePort;

const clock: AnimationClock = { now: () => 0, request: () => 1, cancel: () => {} };

async function railWithSession() {
  const session = new StudioSession(runtime, clock, "main");
  await session.start();
  return { session, rail: new CompositionRailViewModel(session) };
}

describe("CompositionRailViewModel", () => {
  it("matches composition discovery by id, key, kind and source file", () => {
    const composition = comp("motion-lab", "Motion Lab");
    composition.kind = "3d";
    composition.file = "src/labs/Motion.ts";
    expect(compositionMatchesSearch(composition, "motion lab")).toBe(true);
    expect(compositionMatchesSearch(composition, "motion-lab")).toBe(true);
    expect(compositionMatchesSearch(composition, "3D")).toBe(true);
    expect(compositionMatchesSearch(composition, "labs/motion")).toBe(true);
    expect(compositionMatchesSearch(composition, "editorial")).toBe(false);
  });
  it("builds a stable forest that does not reshuffle when navigating", async () => {
    const { session, rail } = await railWithSession();
    const shape = () => get(rail.store).primary.map((row) => `${row.composition.key}:${row.depth}`);

    const initial = shape();
    expect(initial).toEqual(["main:0", "title:1", "lib:1", "free:0"]);
    expect(get(rail.store).library.map((entry) => entry.key)).toEqual(["lib"]);

    // opening a comp outside the current tree only moves the highlight
    session.navigate("free");
    expect(shape()).toEqual(initial);
    expect(get(rail.store).currentKey).toBe("free");

    session.navigate("title");
    expect(shape()).toEqual(initial);
  });

  it("exposes the nesting guard for drag feedback", async () => {
    const { rail } = await railWithSession();
    expect(rail.canNest("free", "main")).toBe(true);
    expect(rail.canNest("main", "title")).toBe(false);
    expect(rail.canNest("title", "title")).toBe(false);
  });
});
