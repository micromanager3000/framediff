import { describe, expect, it } from "vitest";
import {
  aeCameraShot,
  aeEase,
  aeSourceTime,
  aeValue,
  aeVisibleWindows,
  type AeComp,
  type AeLayer,
  type AeProperty,
} from "./aeImport";

const layer = (partial: Partial<AeLayer>): AeLayer => ({
  index: 1,
  name: "layer",
  startTime: 0,
  inPoint: 0,
  outPoint: 10,
  stretch: 100,
  ...partial,
});

const staticProp = (name: string, value: number | number[]): AeProperty => ({ name, value });
const keyedProp = (
  name: string,
  keys: Array<[number, number | number[]]>,
  interp = "6613",
): AeProperty => ({
  name,
  keys: keys.map(([time, value]) => ({ time, value, inInterpolation: interp, outInterpolation: interp })),
});

describe("aeEase", () => {
  it("is AE's default bezier ease — exactly smoothstep", () => {
    expect(aeEase(0)).toBe(0);
    expect(aeEase(1)).toBe(1);
    expect(aeEase(0.5)).toBeCloseTo(0.5, 12);
    expect(aeEase(0.25)).toBeCloseTo(0.15625, 12);
    expect(aeEase(-1)).toBe(0);
    expect(aeEase(2)).toBe(1);
  });
});

describe("aeValue", () => {
  it("passes static values through", () => {
    expect(aeValue(staticProp("Zoom", 2666.6666666), 5)).toBeCloseTo(2666.6666666);
  });

  it("eases bezier keys with smoothstep and clamps outside the range", () => {
    const p = keyedProp("Opacity", [
      [10, 0],
      [12, 100],
    ]);
    expect(aeValue(p, 9)).toBe(0);
    expect(aeValue(p, 13)).toBe(100);
    expect(aeValue(p, 11)).toBeCloseTo(50, 9);
    expect(aeValue(p, 10.5)).toBeCloseTo(15.625, 9);
  });

  it("lerps LINEAR segments and holds HOLD segments", () => {
    const lin = keyedProp("Scale", [
      [0, [50, 50, 100]],
      [2, [60, 60, 100]],
    ], "6612");
    expect(aeValue(lin, 0.5)).toEqual([52.5, 52.5, 100]);
    const hold = keyedProp("Slider", [
      [0, 1],
      [2, 5],
    ], "6614");
    expect(aeValue(hold, 1.999)).toBe(1);
    expect(aeValue(hold, 2)).toBe(5);
  });
});

describe("aeSourceTime", () => {
  it("maps comp time through startTime at realtime", () => {
    const l = layer({ startTime: -3.0864, stretch: 100 });
    expect(aeSourceTime(l, 12.3874)).toBeCloseTo(15.4738, 4);
  });

  it("applies stretch: 111.1111% plays the source at 0.9×", () => {
    const l = layer({ startTime: -3.7784, stretch: 111.1111 });
    expect(aeSourceTime(l, 0)).toBeCloseTo(3.4006, 3);
    // one comp second advances 0.9 source seconds
    expect(aeSourceTime(l, 1) - aeSourceTime(l, 0)).toBeCloseTo(0.9, 4);
  });

  it("applies stretch: 81% plays the source at ~1.2346×", () => {
    const l = layer({ startTime: 18.4855, stretch: 81.0000002384186 });
    expect(aeSourceTime(l, 32.622)).toBeCloseTo(17.4525, 3);
  });
});

describe("aeVisibleWindows", () => {
  it("recovers the cut list with the top-most layer winning", () => {
    const comp: AeComp = {
      name: "test",
      width: 1920,
      height: 1080,
      duration: 10,
      frameRate: 24,
      layers: [
        layer({ index: 1, name: "top", inPoint: 4, outPoint: 6 }),
        layer({ index: 2, name: "mid", inPoint: 2, outPoint: 8 }),
        layer({ index: 3, name: "base", inPoint: 0, outPoint: 10 }),
      ],
    };
    const wins = aeVisibleWindows(comp, () => true);
    expect(wins.map((w) => [w.layer.name, w.from, w.to])).toEqual([
      ["base", 0, 2],
      ["mid", 2, 4],
      ["top", 4, 6],
      ["mid", 6, 8],
      ["base", 8, 10],
    ]);
  });

  it("merges adjacent windows of the same layer and respects the predicate", () => {
    const comp: AeComp = {
      name: "test",
      width: 1920,
      height: 1080,
      duration: 10,
      frameRate: 24,
      layers: [
        layer({ index: 1, name: "text", inPoint: 3, outPoint: 5, hasVideo: true, adjustmentLayer: false }),
        layer({ index: 2, name: "clip", inPoint: 0, outPoint: 10 }),
      ],
    };
    const wins = aeVisibleWindows(comp, (l) => l.name !== "text");
    expect(wins).toHaveLength(1);
    expect(wins[0].layer.name).toBe("clip");
  });
});

describe("aeCameraShot", () => {
  // AE's resting state: camera at [cx, cy, -zoom] looking at [cx, cy, 0] renders a
  // comp-filling layer exactly 1:1. That must convert to a plane exactly filling the frame.
  it("converts the identity framing: default camera + comp-filling plane", () => {
    const cameraLayer = layer({
      name: "Camera",
      properties: [
        {
          name: "Transform",
          properties: [
            staticProp("Position", [960, 540, -2666.6666666]),
            staticProp("Point of Interest", [960, 540, 0]),
          ],
        },
        { name: "Camera Options", properties: [staticProp("Zoom", 2666.6666666)] },
      ],
    });
    const planeLayer = layer({
      name: "Plane",
      properties: [
        {
          name: "Transform",
          properties: [staticProp("Position", [960, 540, 0]), staticProp("Scale", [50, 50, 100])],
        },
      ],
    });
    const shot = aeCameraShot({
      cameraLayer,
      planeLayer,
      planeSourceSize: [3840, 2160],
      comp: { width: 1920, height: 1080, frameRate: 23.976 },
      shotStart: 0,
    });
    // 3840×2160 at 50% = 1920×1080 px = [16/9, 1] world units
    expect(shot.planeSize[0]).toBeCloseTo(16 / 9, 9);
    expect(shot.planeSize[1]).toBeCloseTo(1, 9);
    expect(shot.cameraKeyframes).toHaveLength(1);
    const pose = shot.cameraKeyframes[0].pose;
    expect(pose.cameraPosition).toEqual([0, 0, 2666.6666666 / 1080]);
    expect(pose.cameraTarget).toEqual([0, 0, 0]);
    // the plane must exactly fill the vertical FOV: tan(fov/2)·distance = half plane height
    const fovV = 2 * Math.atan((pose.sensorHeight ?? 24) / (2 * pose.focalLength!));
    expect(Math.tan(fovV / 2) * (2666.6666666 / 1080)).toBeCloseTo(0.5, 9);
  });

  it("converts keyframed camera moves into plane-relative, y-up poses with frame offsets", () => {
    const cameraLayer = layer({
      name: "Camera 7",
      inPoint: 14.5145,
      outPoint: 16.9336,
      properties: [
        {
          name: "Transform",
          properties: [
            keyedProp("Position", [
              [14.5145, [960, 540, -2666.6666666]],
              [16.8919, [1473.617, 1441.419, -1233.033]],
            ]),
            keyedProp("Point of Interest", [
              [14.5145, [960, 540, 0]],
              [16.8919, [921.709, 616.448, 13.552]],
            ]),
          ],
        },
        {
          name: "Camera Options",
          properties: [
            staticProp("Zoom", 2666.6666666),
            keyedProp("Focus Distance", [
              [14.5145, 2665.395],
              [16.8919, 1562.395],
            ]),
            keyedProp("Aperture", [
              [14.5145, 134.818],
              [16.8919, 4],
            ]),
            keyedProp("Blur Level", [
              [14.5145, 537.434],
              [16.8919, 487.434],
            ]),
          ],
        },
      ],
    });
    const planeLayer = layer({
      name: "Screen Recording",
      properties: [
        {
          name: "Transform",
          properties: [staticProp("Position", [960, 540, 0]), staticProp("Scale", [48, 48, 48])],
        },
      ],
    });
    const shot = aeCameraShot({
      cameraLayer,
      planeLayer,
      planeSourceSize: [3288, 2240],
      comp: { width: 1920, height: 1080, frameRate: 23.976 },
      shotStart: 14.5145,
    });
    expect(shot.planeSize[0]).toBeCloseTo((3288 * 0.48) / 1080, 6);
    expect(shot.planeSize[1]).toBeCloseTo((2240 * 0.48) / 1080, 6);
    expect(shot.cameraKeyframes).toHaveLength(2);
    const [k0, k1] = shot.cameraKeyframes;
    expect(k0.frame).toBeCloseTo(0, 6);
    expect(k1.frame).toBeCloseTo((16.8919 - 14.5145) * 23.976, 6);
    // start: camera dead-on at zoom distance
    expect(k0.pose.cameraPosition![2]).toBeCloseTo(2666.6666666 / 1080, 6);
    // end: AE +x stays +x, AE +y (down) flips to -y, AE -z (toward viewer) flips to +z
    expect(k1.pose.cameraPosition![0]).toBeCloseTo((1473.617 - 960) / 1080, 6);
    expect(k1.pose.cameraPosition![1]).toBeCloseTo((540 - 1441.419) / 1080, 6);
    expect(k1.pose.cameraPosition![2]).toBeCloseTo(1233.033 / 1080, 6);
    expect(k1.pose.focusDistance).toBeCloseTo(1562.395 / 1080, 6);
    expect(k0.pose.focalLength).toBeCloseTo((24 * 2666.6666666) / 1080, 6);
    // AE coc_px = aperture · blur% · zoom · |1/f − 1/z| (px) → the renderer's thin-lens
    // aperture term is aperture · blur% · zoom / compHeight, CoC lands in true screen pixels
    expect(k0.pose.depthOfField).toBeCloseTo((134.818 * (537.434 / 100) * 2666.6666666) / 1080, 3);
    expect(k1.pose.depthOfField).toBeCloseTo((4 * (487.434 / 100) * 2666.6666666) / 1080, 3);
  });

  it("rejects planes with animated transforms or rotation", () => {
    const cameraLayer = layer({
      name: "Camera",
      properties: [
        {
          name: "Transform",
          properties: [staticProp("Position", [0, 0, -100]), staticProp("Point of Interest", [0, 0, 0])],
        },
        { name: "Camera Options", properties: [staticProp("Zoom", 100)] },
      ],
    });
    const animated = layer({
      name: "Plane",
      properties: [
        {
          name: "Transform",
          properties: [
            keyedProp("Position", [
              [0, [0, 0, 0]],
              [1, [10, 0, 0]],
            ]),
          ],
        },
      ],
    });
    expect(() =>
      aeCameraShot({
        cameraLayer,
        planeLayer: animated,
        planeSourceSize: [100, 100],
        comp: { width: 1920, height: 1080, frameRate: 24 },
        shotStart: 0,
      }),
    ).toThrow(/static transform/);

    const rotated = layer({
      name: "Plane",
      properties: [
        {
          name: "Transform",
          properties: [staticProp("Position", [0, 0, 0]), staticProp("Y Rotation", 15)],
        },
      ],
    });
    expect(() =>
      aeCameraShot({
        cameraLayer,
        planeLayer: rotated,
        planeSourceSize: [100, 100],
        comp: { width: 1920, height: 1080, frameRate: 24 },
        shotStart: 0,
      }),
    ).toThrow(/rotated/);
  });
});
