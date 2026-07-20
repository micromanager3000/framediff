import { describe, expect, it } from "vitest";
import { cameraKeyframesFromProgress, cameraPoseAtFrame, monotoneCubic, type CameraKeyframe } from "./camera";

const plane = {
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

const keys: CameraKeyframe[] = [
  { frame: 0, pose: { cameraPosition: [0, 0, 2], cameraTarget: [0, 0, 0] } },
  { frame: 10, pose: { cameraPosition: [10, 0, 2], cameraTarget: [10, 0, 0] } },
  { frame: 20, pose: { cameraPosition: [20, 0, 2], cameraTarget: [20, 0, 0] } },
];

describe("VideoPlane3D camera interpolation", () => {
  it("monotone fitted paths keep moving through interior keys", () => {
    const before = cameraPoseAtFrame({ keyframes: keys, frame: 9.9, maxBlur: 0, plane, interpolation: "monotone" }).eye![0];
    const at = cameraPoseAtFrame({ keyframes: keys, frame: 10, maxBlur: 0, plane, interpolation: "monotone" }).eye![0];
    const after = cameraPoseAtFrame({ keyframes: keys, frame: 10.1, maxBlur: 0, plane, interpolation: "monotone" }).eye![0];

    expect(at - before).toBeCloseTo(0.1, 6);
    expect(after - at).toBeCloseTo(0.1, 6);
  });

  it("AE ease still settles at each segment key", () => {
    const before = cameraPoseAtFrame({ keyframes: keys, frame: 9.9, maxBlur: 0, plane, interpolation: "ease" }).eye![0];
    const at = cameraPoseAtFrame({ keyframes: keys, frame: 10, maxBlur: 0, plane, interpolation: "ease" }).eye![0];
    const after = cameraPoseAtFrame({ keyframes: keys, frame: 10.1, maxBlur: 0, plane, interpolation: "ease" }).eye![0];

    expect(at - before).toBeLessThan(0.01);
    expect(after - at).toBeLessThan(0.01);
  });

  it("linear interpolation preserves segment velocity for AE imports without temporal ease data", () => {
    const before = cameraPoseAtFrame({ keyframes: keys, frame: 9.9, maxBlur: 0, plane, interpolation: "linear" }).eye![0];
    const at = cameraPoseAtFrame({ keyframes: keys, frame: 10, maxBlur: 0, plane, interpolation: "linear" }).eye![0];
    const after = cameraPoseAtFrame({ keyframes: keys, frame: 10.1, maxBlur: 0, plane, interpolation: "linear" }).eye![0];

    expect(at - before).toBeCloseTo(0.1, 6);
    expect(after - at).toBeCloseTo(0.1, 6);
  });

  it("monotone cubic does not overshoot uneven fitted progress samples", () => {
    const xs = [0, 0.25, 0.6, 1];
    const values = [0, 0.07, 0.64, 1];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let step = 0; step <= 10; step++) {
        const x = xs[i] + ((xs[i + 1] - xs[i]) * step) / 10;
        const y = monotoneCubic(xs, values, i, x);
        expect(y).toBeGreaterThanOrEqual(values[i] - 1e-9);
        expect(y).toBeLessThanOrEqual(values[i + 1] + 1e-9);
      }
    }
  });

  it("expands fitted pose and aperture progress into shared camera keys", () => {
    const fitted = cameraKeyframesFromProgress({
      from: { cameraPosition: [0, 0, 2], depthOfField: 0 },
      to: { cameraPosition: [10, 0, 1], depthOfField: 1 },
      startFrame: -5,
      endFrame: 15,
      progress: [[0, 0], [0.5, 0.25], [1, 1]],
      depthOfFieldProgress: [[0, 0], [0.25, 0.8], [1, 1]],
    });
    expect(fitted.map((key) => key.frame)).toEqual([-5, 0, 5, 15]);
    expect(fitted[2].pose.cameraPosition).toEqual([2.5, 0, 1.75]);
    expect(fitted[1].pose.depthOfField).toBeCloseTo(0.8);
  });
});
