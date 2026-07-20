// Optional three.js integration for framework-free HTML compositions.

export {
  defineThreeScene,
  type ThreeSceneDef,
  type ThreeSceneContext,
  type ThreeSceneInstance,
  type SceneCameraDef,
} from "./sceneDef";
export { createThreeSceneSetup, type ThreeSceneSetupOptions } from "./runtime";
export {
  defineThreeSceneComposition,
  type ThreeSceneCompositionOptions,
  type ThreeSceneCameraCut,
} from "./composition";
export {
  evaluateCameraTrack,
  resolveSceneCamera,
  focalLengthToFov,
  type ResolvedCameraPose,
} from "./cameraTrack";
