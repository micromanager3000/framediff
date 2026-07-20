// Evaluate a virtual camera at a (fractional) scene frame, in three.js terms: eye/target world
// positions + vertical FOV in degrees. Interpolation semantics mirror the HTML video-plane adapter
// ("ease" = AE-style per-segment influence, default 1/3 = smoothstep; "linear"; "monotone" =
// Fritsch–Carlson through 3+ keys for fitted paths) so a camera move reads the same whether it
// drives the 2.5D plane tier or a full three.js scene. Focus/DoF pose fields are ignored here.

import { aeEaseInfluence } from "../effects/ease";
import type { V3 } from "../effects/mat4";
import type { CameraKeyframe, CameraInterpolation, VirtualCameraPose } from "../effects/camera";
import type { SceneCameraDef } from "./sceneDef";

export interface ResolvedCameraPose {
  eye: V3;
  target: V3;
  /** Vertical field of view, degrees. */
  fov: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lv = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const focalLengthToFov = (focalLength: number, sensorHeight = 24): number =>
  (2 * Math.atan(sensorHeight / (2 * Math.max(1, focalLength))) * 180) / Math.PI;

/** Scene-camera default: a loose full-frame 35mm at [0,0,5] looking at the origin. */
function resolvePose(p: VirtualCameraPose): ResolvedCameraPose {
  return {
    eye: p.cameraPosition ?? [0, 0, 5],
    target: p.cameraTarget ?? [0, 0, 0],
    fov: focalLengthToFov(p.focalLength ?? 35, p.sensorHeight ?? 24),
  };
}

/** Monotone cubic (Fritsch–Carlson) — same math as the video plane's fitted-path interpolation. */
function monotoneCubic(xs: number[], values: number[], seg: number, x: number): number {
  const n = xs.length;
  const h = (i: number) => xs[i + 1] - xs[i];
  const delta = (i: number) => (values[i + 1] - values[i]) / h(i);
  const tangent = (i: number): number => {
    if (i === 0) return delta(0);
    if (i === n - 1) return delta(n - 2);
    const d0 = delta(i - 1);
    const d1 = delta(i);
    if (d0 * d1 <= 0) return 0;
    const w1 = 2 * h(i) + h(i - 1);
    const w2 = h(i) + 2 * h(i - 1);
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  };
  const hi = h(seg);
  const t = (x - xs[seg]) / hi;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * values[seg] +
    (t3 - 2 * t2 + t) * hi * tangent(seg) +
    (-2 * t3 + 3 * t2) * values[seg + 1] +
    (t3 - t2) * hi * tangent(seg + 1)
  );
}

/** Evaluate keyframed camera channels at a fractional frame, clamped outside the key range. */
export function evaluateCameraTrack(
  keyframes: CameraKeyframe[],
  frame: number,
  interpolation: CameraInterpolation = "ease",
): ResolvedCameraPose {
  const ks = [...keyframes].sort((a, b) => a.frame - b.frame);
  const last = ks.length - 1;
  let seg = -1; // -1 = before first, last = after last
  for (let i = 0; i < last; i++) {
    if (frame > ks[i].frame && frame <= ks[i + 1].frame) { seg = i; break; }
  }
  if (frame > ks[last].frame) seg = last;

  if (seg === -1 || seg === last) return resolvePose(ks[seg === -1 ? 0 : last].pose);

  if ((interpolation === "monotone" || interpolation === "spline") && ks.length >= 3) {
    const xs = ks.map((k) => k.frame);
    const ch = ks.map((k) => resolvePose(k.pose));
    const s = (pick: (p: ResolvedCameraPose) => number) => monotoneCubic(xs, ch.map(pick), seg, frame);
    return {
      eye: [s((p) => p.eye[0]), s((p) => p.eye[1]), s((p) => p.eye[2])],
      target: [s((p) => p.target[0]), s((p) => p.target[1]), s((p) => p.target[2])],
      fov: s((p) => p.fov),
    };
  }

  const f = resolvePose(ks[seg].pose);
  const g = resolvePose(ks[seg + 1].pose);
  const u = (frame - ks[seg].frame) / (ks[seg + 1].frame - ks[seg].frame);
  const [outInf, inInf] = ks[seg].ease ?? [1 / 3, 1 / 3];
  const t = interpolation === "linear" ? Math.max(0, Math.min(1, u)) : aeEaseInfluence(u, outInf, inInf);
  return { eye: lv(f.eye, g.eye, t), target: lv(f.target, g.target, t), fov: lerp(f.fov, g.fov, t) };
}

/** Resolve a named camera at a scene frame: poseAt > keyframes > pose (first match wins). */
export function resolveSceneCamera(def: SceneCameraDef, frame: number, fps: number): ResolvedCameraPose {
  if (def.poseAt) return resolvePose(def.poseAt(frame / fps, frame));
  if (def.keyframes && def.keyframes.length > 0) return evaluateCameraTrack(def.keyframes, frame, def.interpolation);
  return resolvePose(def.pose ?? {});
}
