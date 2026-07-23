import { describe, expect, it } from "vitest";
import {
  clipMotion2DFromDocument,
  createAudioFadeOutSetup,
  createWipeRevealSetup,
  evaluateClipMotion2D,
  evaluateSplitScreenRevealEdge,
  type ClipMotion2D,
} from "./domTimelineEffects";
import { gradeDataAttributes } from "./gradeAttributes";

describe("project-configurable effect helpers", () => {
  it("evaluates source-space clip motion independently of a composition", () => {
    const motion: ClipMotion2D = {
      anchor: [50, 25],
      sourceSize: [100, 50],
      startFrame: 0,
      endFrame: 10,
      startPosition: [0, 10],
      endPosition: [100, 30],
      startScale: 0.5,
      endScale: 1,
    };
    expect(evaluateClipMotion2D(motion, 5)).toEqual({ x: 50, y: 20, scale: 0.75 });
  });

  it("converts scalar JSON motion with compact or numbered paths", () => {
    const values = {
      anchorX: 50, anchorY: 25, sourceWidth: 100, sourceHeight: 50,
      startFrame: 0, endFrame: 10, startX: 0, startY: 10, endX: 100, endY: 30,
      startScale: 0.5, endScale: 1, interpolation: "smooth",
    };
    expect(clipMotion2DFromDocument({ ...values, path: "0:10:20|10:90:40" }).path).toEqual([
      { frame: 0, position: [10, 20] },
      { frame: 10, position: [90, 40] },
    ]);
    expect(clipMotion2DFromDocument({
      ...values,
      path1Frame: 10, path1X: 90, path1Y: 40,
      path0Frame: 0, path0X: 10, path0Y: 20,
    }).path).toEqual([
      { frame: 0, position: [10, 20] },
      { frame: 10, position: [90, 40] },
    ]);
  });

  it("uses the containing clip clock when a wipe is authored on a child element", () => {
    const owner = { dataset: { fdLocalFrame: "51" } };
    const style: Record<string, string> = {};
    const wipe = {
      dataset: { fdWipe: "smooth", fdWipeFrom: "28", fdWipeTo: "74" },
      style,
      matches: () => false,
      closest: () => owner,
    };
    let listener: ((state: never) => void) | undefined;
    createWipeRevealSetup()({
      root: { querySelectorAll: () => [wipe] },
      onFrame: (next: (state: never) => void) => { listener = next; return () => undefined; },
      onCleanup: () => undefined,
    } as never);

    listener!({} as never);
    expect(style.clipPath).toBe("inset(0 50% 0 0)");
  });

  it("serializes typed grade fields to the HTML effect ABI", () => {
    expect(gradeDataAttributes({ exposure: 0.2, bloomThreshold: 0.55 })).toEqual({
      "data-fd-grade-exposure": 0.2,
      "data-fd-grade-bloom-threshold": 0.55,
    });
  });

  it("maps a moving pane onto a reusable split-screen edge", () => {
    const mapping = { fromPosition: 2144, toPosition: 1764, fromEdge: 1920, toEdge: 960 };
    expect(evaluateSplitScreenRevealEdge(2144, mapping)).toBe(1920);
    expect(evaluateSplitScreenRevealEdge(1954, mapping)).toBe(1440);
    expect(evaluateSplitScreenRevealEdge(1764, mapping)).toBe(960);
    expect(evaluateSplitScreenRevealEdge(2400, mapping)).toBe(1920);
    expect(evaluateSplitScreenRevealEdge(1500, mapping)).toBe(960);
  });

  it("refreshes an audio fade from composition document edits", () => {
    const audio = { dataset: {}, volume: 0 };
    let frameListener: ((state: { frame: number }) => void) | undefined;
    let documentListener: ((value: unknown) => void) | undefined;
    createAudioFadeOutSetup({
      selector: "[data-audio]",
      settings: (value) => value as { from: number; to: number; volume: number },
    })({
      root: { querySelector: () => audio },
      document: { from: 0, to: 10, volume: 1 },
      onFrame: (next: (state: { frame: number }) => void) => { frameListener = next; return () => undefined; },
      onDocument: (next: (value: unknown) => void) => { documentListener = next; return () => undefined; },
      onCleanup: () => undefined,
    } as never);

    frameListener!({ frame: 5 });
    expect(audio.volume).toBe(0.5);
    documentListener!({ from: 0, to: 20, volume: 0.8 });
    frameListener!({ frame: 5 });
    expect(audio.volume).toBeCloseTo(0.6);
  });
});
