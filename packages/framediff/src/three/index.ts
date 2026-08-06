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
  THREE_SCENE_DATA_VERSION,
  type ThreeSceneCompositionData,
  type ThreeSceneCompositionOptions,
  type ThreeSceneCameraCut,
} from "./composition";
export {
  evaluateCameraTrack,
  resolveSceneCamera,
  focalLengthToFov,
  type ResolvedCameraPose,
} from "./cameraTrack";
export { loadCameraFile, parseCameraFile, type CameraTrackFile } from "./cameraLab";
