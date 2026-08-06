import { describe, expect, it, vi } from "vitest";
import type { CompositionSetupContext } from "../composition";
import { defineGsapTimeline, getGsapRuntimeTraces, type FrameGsapTimeline } from "./index";

function contextFor(
  onFrame: (listener: (state: { frame: number }) => void) => () => void,
  onCleanup: (cleanup: () => void) => void,
): CompositionSetupContext {
  return {
    root: {} as HTMLElement,
    composition: { definition: { version: 1, type: "html", kind: "scene" }, id: "test", html: "", width: 100, height: 100, fps: 30, durationInFrames: 90 },
    registry: {},
    signal: new AbortController().signal,
    query: () => null,
    queryAll: () => [],
    onFrame: onFrame as CompositionSetupContext["onFrame"],
    onDocument: () => () => {},
    onCleanup,
    resolveAsset: async (ref) => ref,
  };
}

describe("defineGsapTimeline", () => {
  it("pauses once and seeks every requested frame absolutely", async () => {
    let listener: ((state: { frame: number }) => void) | undefined;
    let cleanup: (() => void) | undefined;
    const stop = vi.fn();
    const timeline: FrameGsapTimeline = {
      pause: vi.fn(function (this: FrameGsapTimeline) { return this; }),
      totalTime: vi.fn(function (this: FrameGsapTimeline) { return this; }),
      kill: vi.fn(),
    };
    const revert = vi.fn();
    const engine = { context: vi.fn((callback: () => void) => { callback(); return { revert }; }) };
    let frames!: (count: number) => number;
    const setup = defineGsapTimeline((factoryContext) => {
      frames = factoryContext.frames;
      return timeline;
    }, { engine: engine as never });

    await setup(contextFor((next) => { listener = next; return stop; }, (next) => { cleanup = next; }));
    expect(frames(15)).toBe(0.5);
    expect(timeline.pause).toHaveBeenCalledWith(0, true);

    listener?.({ frame: 60 });
    listener?.({ frame: 7 });
    listener?.({ frame: 60 });
    expect(timeline.totalTime).toHaveBeenNthCalledWith(1, 2, true);
    expect(timeline.totalTime).toHaveBeenNthCalledWith(2, 7 / 30, true);
    expect(timeline.totalTime).toHaveBeenNthCalledWith(3, 2, true);

    cleanup?.();
    expect(stop).toHaveBeenCalledOnce();
    expect(timeline.kill).toHaveBeenCalledOnce();
    expect(revert).toHaveBeenCalledOnce();
  });

  it("rejects a factory that forgets to return its timeline", async () => {
    const engine = { context: (callback: () => void) => { callback(); return { revert() {} }; } };
    const setup = defineGsapTimeline(() => undefined as never, { engine: engine as never });
    expect(() => setup(contextFor(() => () => {}, () => {}))).toThrow(/must return/);
  });

  it("ignores private fromTo bookkeeping while still tracing literal authored values", async () => {
    class FakeElement {
      getAttribute(name: string) { return name === "data-fd-id" ? "dot" : null; }
    }
    vi.stubGlobal("Element", FakeElement);
    const tween = {
      vars: { y: 0, opacity: 1, duration: 0.6, ease: "power1.out" },
      _startAt: { vars: { y: -18, opacity: 0, repeat: 0, onUpdate: () => {} } },
      targets: () => [new FakeElement()],
      duration: () => 0.6,
      startTime: () => 0.4,
      globalTime: () => 0.5,
    };
    let reads = 0;
    const timeline: FrameGsapTimeline = {
      pause() { return this; },
      totalTime() { return this; },
      kill() {},
      getChildren: () => reads++ === 0 ? [] : [tween],
    };
    const engine = { context: (callback: () => void) => { callback(); return { revert() {} }; } };
    const setup = defineGsapTimeline(({ unroll }) => {
      unroll("dots", timeline, () => {});
      return timeline;
    }, { engine: engine as never });

    await setup(contextFor(() => () => {}, () => {}));
    expect(getGsapRuntimeTraces("test")).toEqual([{
      id: "dots",
      serializable: true,
      issues: [],
      operations: [{
        target: '[data-fd-id="dot"]',
        kind: "fromTo",
        startFrame: 15,
        durationInFrames: 18,
        from: { y: -18, opacity: 0 },
        to: { y: 0, opacity: 1 },
        ease: "power1.out",
      }],
    }]);
    vi.unstubAllGlobals();
  });
});
