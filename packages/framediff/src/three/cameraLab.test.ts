import { describe, expect, it, vi } from "vitest";
import {
  cameraKeyframeFromPose,
  cameraLabShouldMount,
  cameraLabPoseFromVirtual,
  cameraRotationFromTarget,
  cameraTargetFromRotation,
  degreesToRadians,
  parseCameraFile,
  persistCameraFile,
  radiansToDegrees,
  type CameraLabPose,
} from "./cameraLab";
import { cameraFrameWithinCut, evaluateCameraTrack } from "./cameraTrack";

const fallback: CameraLabPose = {
  eye: [0, 2, 8],
  target: [0, 1, 0],
  rotation: cameraRotationFromTarget([0, 2, 8], [0, 1, 0]),
  focalLength: 35,
};

describe("Camera Lab", () => {
  it("round-trips look-at direction through editable pitch/yaw/roll channels", () => {
    const eye: [number, number, number] = [2, 3, 7];
    const target: [number, number, number] = [-1, 1, 0];
    const rotation = cameraRotationFromTarget(eye, target, degreesToRadians(12));
    const projected = cameraTargetFromRotation(eye, rotation, Math.hypot(3, 2, 7));
    const direction = (point: number[]) => {
      const delta = point.map((value, index) => value - eye[index]);
      const length = Math.hypot(...delta);
      return delta.map((value) => value / length);
    };

    expect(direction(projected)).toEqual(expect.arrayContaining(direction(target).map((value) => expect.closeTo(value, 6))));
    expect(radiansToDegrees(rotation[2])).toBeCloseTo(12, 8);
  });

  it("persists position, rotation, target, lens, and frame as ordinary camera JSON", () => {
    const pose = cameraLabPoseFromVirtual({
      cameraPosition: [1, 2, 3],
      cameraRotation: [0.1, 0.2, 0.3],
      focalLength: 58,
    }, fallback);
    const key = cameraKeyframeFromPose(42.4, pose);

    expect(key).toMatchObject({
      frame: 42,
      pose: {
        cameraPosition: [1, 2, 3],
        cameraRotation: [0.1, 0.2, 0.3],
        focalLength: 58,
      },
    });
    expect(key.pose.cameraTarget).toHaveLength(3);
  });

  it("evaluates explicit rotation channels between editable keys", () => {
    const keys = [
      cameraKeyframeFromPose(0, { ...fallback, rotation: [0, 0, 0] }),
      cameraKeyframeFromPose(20, { ...fallback, rotation: [0.4, 0.8, 0.2] }),
    ];
    const pose = evaluateCameraTrack(keys, 10, "linear");
    expect(pose.rotation?.[0]).toBeCloseTo(0.2, 10);
    expect(pose.rotation?.[1]).toBeCloseTo(0.4, 10);
    expect(pose.rotation?.[2]).toBeCloseTo(0.1, 10);
  });

  it("starts a scene-authored camera move at the beginning of each camera cut", () => {
    expect(cameraFrameWithinCut(90, 90)).toBe(0);
    expect(cameraFrameWithinCut(210, 90)).toBe(120);
  });

  it("normalizes malformed files and sorts valid keys", () => {
    const parsed = parseCameraFile(JSON.stringify({
      version: 99,
      cameras: {
        counter: { interpolation: "linear", keyframes: [
          { frame: 30, pose: { focalLength: 50 } },
          { nope: true },
          { frame: 0, pose: { focalLength: 35 } },
        ] },
        broken: "nope",
      },
    }));
    expect(parsed).toEqual({
      version: 1,
      cameras: { counter: { interpolation: "linear", keyframes: [
        { frame: 0, pose: { focalLength: 35 } },
        { frame: 30, pose: { focalLength: 50 } },
      ] } },
    });
  });

  it("surfaces a rejected camera-file write instead of leaving saving inert", async () => {
    const writer = vi.fn(async () => false);
    await expect(persistCameraFile("src/shot.cameras.json", { version: 1, cameras: {} }, writer))
      .rejects.toThrow("Could not save camera keys");
    expect(writer).toHaveBeenCalledOnce();
  });
});

describe("cameraLabShouldMount", () => {
  it("mounts only for authoring instances with a camera file", () => {
    expect(cameraLabShouldMount("src/Comp.cameras.json", undefined)).toBe(true);
    expect(cameraLabShouldMount("src/Comp.cameras.json", false)).toBe(true);
    expect(cameraLabShouldMount(undefined, undefined)).toBe(false);
  });

  it("never mounts into a capture/bake instance — the HUD would be burned into exports", () => {
    expect(cameraLabShouldMount("src/Comp.cameras.json", true)).toBe(false);
  });
});
