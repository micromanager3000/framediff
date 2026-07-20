// A three.js scene as FrameDiff content: `defineThreeScene` declares the world once (meshes,
// lights, animation) plus a set of NAMED virtual cameras. The scene animates in *scene time*
// (the frame of the comp that mounts it) so camera cuts never reset a walk cycle mid-stride;
// cameras animate in that same clock and timeline cuts just choose which one is live.
//
// Everything here must be a pure function of time — `update(time)` re-derives all animation
// from the absolute time (drive THREE.AnimationMixer with mixer.setTime(time), not .update(dt))
// so preview scrubbing and the deterministic exporter see identical frames.

import type * as THREE from "three";
import type { CameraKeyframe, CameraInterpolation, VirtualCameraPose } from "../effects/camera";

/** Handed to `create` once, when the scene mounts. Never constructed during a Studio probe. */
export interface ThreeSceneContext {
  scene: THREE.Scene;
  /** The live renderer — for opt-in renderer-level looks (shadows, tone mapping). */
  renderer: THREE.WebGLRenderer;
  /** Canvas pixel size (defaults to the comp's dimensions). */
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

/** What `create` returns: per-frame animation + teardown for anything create() allocated. */
export interface ThreeSceneInstance {
  /** Advance ALL animation to an absolute scene time (seconds). Must be deterministic in `time` —
   *  use mixer.setTime / recompute transforms; never accumulate deltas. */
  update?: (time: number, frame: number) => void;
  dispose?: () => void;
}

/** One named virtual camera. Exactly one of `poseAt` / `keyframes` / `pose` drives it
 *  (first match wins). Poses reuse the HTML video-plane vocabulary: cameraPosition/cameraTarget
 *  in world units, focalLength in mm (sensorHeight 24 ⇒ full-frame vertical FOV).
 *  Focus/depth-of-field fields are accepted but ignored — no DoF pass in this tier yet. */
export interface SceneCameraDef {
  /** Procedural pose — evaluated every frame in scene time (e.g. follow a character). */
  poseAt?: (time: number, frame: number) => VirtualCameraPose;
  /** Keyframed pose in SCENE-time frames — same easing semantics as the HTML video plane. */
  keyframes?: CameraKeyframe[];
  interpolation?: CameraInterpolation;
  /** Static pose shorthand. */
  pose?: VirtualCameraPose;
  near?: number;
  far?: number;
}

export interface ThreeSceneDef {
  /** Stable id — shown in the Studio and used to label bare placements. */
  id: string;
  /** Build the world (runs once per mount; may be async for GLTF/texture loads). */
  create: (ctx: ThreeSceneContext) => ThreeSceneInstance | void | Promise<ThreeSceneInstance | void>;
  /** Named animatable cameras — these are what you drop on the timeline. */
  cameras: Record<string, SceneCameraDef>;
}

/** Identity with types — a recipe object the comp file owns, like `generative()` recipes. */
export function defineThreeScene(def: ThreeSceneDef): ThreeSceneDef {
  return def;
}
