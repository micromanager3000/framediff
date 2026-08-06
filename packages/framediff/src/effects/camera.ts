import type { V3 } from "./mat4";
import type { Plane3DParams } from "./scene3d";
import { aeEaseInfluence } from "./ease";

export interface Plane3DTransform {
  position?: V3;
  rotation?: V3;
  scale?: number | V3;
}

export interface VirtualCameraPose {
  cameraPosition?: V3;
  cameraTarget?: V3;
  /** Camera Euler rotation in radians, ordered pitch (X), yaw (Y), roll (Z).
   *  When present it is authoritative over cameraTarget for rendering. */
  cameraRotation?: V3;
  focalLength?: number;
  focusPosition?: V3;
  focusDistance?: number;
  depthOfField?: number;
  sensorHeight?: number;
}

export interface CameraKeyframe {
  frame: number;
  pose: VirtualCameraPose;
  ease?: [number, number];
}

export type CameraProgressCurve = Array<[time: number, progress: number]>;

export interface CameraKeyframesFromProgressOptions {
  from: VirtualCameraPose;
  to: VirtualCameraPose;
  startFrame: number;
  endFrame: number;
  /** Normalized time → normalized pose progress. Omit for one ordinary endpoint segment. */
  progress?: CameraProgressCurve;
  /** Optional independent normalized curve for the depth-of-field channel. */
  depthOfFieldProgress?: CameraProgressCurve;
  ease?: [number, number];
}

export type CameraInterpolation = "ease" | "linear" | "monotone" | "spline";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const distance = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const focalLengthToFov = (focalLength: number, sensorHeight = 24) =>
  2 * Math.atan(sensorHeight / (2 * Math.max(1, focalLength))) * 180 / Math.PI;

const mixNumber = (from: number | undefined, to: number | undefined, t: number): number | undefined => {
  if (from == null) return to;
  if (to == null) return from;
  return lerp(from, to, t);
};

const mixVector = (from: V3 | undefined, to: V3 | undefined, t: number): V3 | undefined => {
  if (!from) return to;
  if (!to) return from;
  return lerpV3(from, to, t);
};

const mixAngleVector = (from: V3 | undefined, to: V3 | undefined, t: number): V3 | undefined => {
  if (!from) return to;
  if (!to) return from;
  const angle = (a: number, b: number) => {
    const delta = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + delta * t;
  };
  return [angle(from[0], to[0]), angle(from[1], to[1]), angle(from[2], to[2])];
};

/** Linearly mix authored virtual-camera channels while preserving optional fields. */
export function interpolateVirtualCameraPose(
  from: VirtualCameraPose,
  to: VirtualCameraPose,
  progress: number,
): VirtualCameraPose {
  const t = Math.max(0, Math.min(1, progress));
  return {
    cameraPosition: mixVector(from.cameraPosition, to.cameraPosition, t),
    cameraTarget: mixVector(from.cameraTarget, to.cameraTarget, t),
    cameraRotation: mixAngleVector(from.cameraRotation, to.cameraRotation, t),
    focalLength: mixNumber(from.focalLength, to.focalLength, t),
    focusPosition: mixVector(from.focusPosition, to.focusPosition, t),
    focusDistance: mixNumber(from.focusDistance, to.focusDistance, t),
    depthOfField: mixNumber(from.depthOfField, to.depthOfField, t),
    sensorHeight: mixNumber(from.sensorHeight, to.sensorHeight, t),
  };
}

function sampleProgressCurve(points: CameraProgressCurve, value: number): number {
  if (value <= points[0][0]) return points[0][1];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    if (value <= x1) return lerp(y0, y1, (value - x0) / Math.max(1e-6, x1 - x0));
  }
  return points.at(-1)![1];
}

/** Expand fitted normalized progress curves into ordinary camera keyframes. */
export function cameraKeyframesFromProgress(options: CameraKeyframesFromProgressOptions): CameraKeyframe[] {
  if (!options.progress?.length) return [
    { frame: options.startFrame, pose: options.from, ease: options.ease },
    { frame: options.endFrame, pose: options.to },
  ];
  const stops = [...new Set([
    ...options.progress.map(([time]) => time),
    ...(options.depthOfFieldProgress ?? []).map(([time]) => time),
  ])].sort((a, b) => a - b);
  const span = options.endFrame - options.startFrame;
  return stops.map((time) => {
    const pose = interpolateVirtualCameraPose(options.from, options.to, sampleProgressCurve(options.progress!, time));
    if (options.depthOfFieldProgress?.length) {
      pose.depthOfField = interpolateVirtualCameraPose(
        options.from,
        options.to,
        sampleProgressCurve(options.depthOfFieldProgress, time),
      ).depthOfField;
    }
    return { frame: options.startFrame + time * span, pose };
  });
}

const rendererPose = (pose: VirtualCameraPose) => {
  const eye = pose.cameraPosition ?? [0, 0, 1.4] as V3;
  const target = pose.cameraTarget ?? [0, 0, 0] as V3;
  const focusPosition = pose.focusPosition ?? target;
  return {
    eye,
    target,
    fov: focalLengthToFov(pose.focalLength ?? 35, pose.sensorHeight),
    focus: pose.focusDistance ?? distance(eye, focusPosition),
    aperture: pose.depthOfField ?? 0,
  };
};

/** Fritsch–Carlson interpolation: continuous velocity without overshoot between fitted samples. */
export function monotoneCubic(xs: number[], values: number[], segment: number, x: number): number {
  const last = xs.length - 1;
  const width = (index: number) => xs[index + 1] - xs[index];
  const slope = (index: number) => (values[index + 1] - values[index]) / width(index);
  const tangent = (index: number): number => {
    if (index === 0) return slope(0);
    if (index === last) return slope(last - 1);
    const before = slope(index - 1);
    const after = slope(index);
    if (before * after <= 0) return 0;
    const w1 = 2 * width(index) + width(index - 1);
    const w2 = width(index) + 2 * width(index - 1);
    return (w1 + w2) / (w1 / before + w2 / after);
  };
  const h = width(segment);
  const t = (x - xs[segment]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * values[segment]
    + (t3 - 2 * t2 + t) * h * tangent(segment)
    + (-2 * t3 + 3 * t2) * values[segment + 1]
    + (t3 - t2) * h * tangent(segment + 1);
}

export interface CameraPoseAtFrameOptions {
  keyframes: CameraKeyframe[];
  frame: number;
  plane?: Plane3DTransform;
  maxBlur?: number;
  interpolation?: CameraInterpolation;
}

/** Evaluate an authored camera track independently of any UI framework or renderer lifecycle. */
export function cameraPoseAtFrame({
  keyframes,
  frame,
  plane = {},
  maxBlur = 0.03,
  interpolation = "ease",
}: CameraPoseAtFrameOptions): Plane3DParams {
  if (!keyframes.length) throw new Error("A camera track needs at least one keyframe.");
  const keys = [...keyframes].sort((a, b) => a.frame - b.frame);
  const samples = keys.map((key) => rendererPose(key.pose));
  const last = keys.length - 1;
  let segment = -1;
  for (let index = 0; index < last; index += 1) {
    if (frame > keys[index].frame && frame <= keys[index + 1].frame) { segment = index; break; }
  }
  if (frame > keys[last].frame) segment = last;

  let eye: V3;
  let target: V3;
  let fov: number;
  let focus: number;
  let aperture: number;
  if (segment === -1 || segment === last) {
    ({ eye, target, fov, focus, aperture } = samples[segment === -1 ? 0 : last]);
  } else if ((interpolation === "monotone" || interpolation === "spline") && keys.length >= 3) {
    const xs = keys.map((key) => key.frame);
    const sample = (pick: (pose: (typeof samples)[number]) => number) => monotoneCubic(xs, samples.map(pick), segment, frame);
    eye = [sample((pose) => pose.eye[0]), sample((pose) => pose.eye[1]), sample((pose) => pose.eye[2])];
    target = [sample((pose) => pose.target[0]), sample((pose) => pose.target[1]), sample((pose) => pose.target[2])];
    fov = sample((pose) => pose.fov);
    focus = sample((pose) => pose.focus);
    aperture = sample((pose) => pose.aperture);
  } else {
    const from = samples[segment];
    const to = samples[segment + 1];
    const progress = (frame - keys[segment].frame) / (keys[segment + 1].frame - keys[segment].frame);
    const [outInfluence, inInfluence] = keys[segment].ease ?? [1 / 3, 1 / 3];
    const t = interpolation === "linear" ? Math.max(0, Math.min(1, progress)) : aeEaseInfluence(progress, outInfluence, inInfluence);
    eye = lerpV3(from.eye, to.eye, t);
    target = lerpV3(from.target, to.target, t);
    fov = lerp(from.fov, to.fov, t);
    focus = lerp(from.focus, to.focus, t);
    aperture = lerp(from.aperture, to.aperture, t);
  }

  const scale = Array.isArray(plane.scale) ? plane.scale : [plane.scale ?? 1, plane.scale ?? 1, 1] as V3;
  return {
    position: plane.position ?? [0, 0, 0],
    rotation: plane.rotation ?? [0, 0, 0],
    scale,
    eye,
    target,
    fov,
    dof: { focus, aperture, maxBlur },
  };
}
