// FrameDiff — author deterministic video compositions as plain HTML, CSS, and JavaScript.

export {
  defineComposition,
  defineTimelineDocument,
  combineCompositionSetups,
  type CompositionConfig,
  type CompositionRegistry,
  type CompositionMetadata,
  type CompositionAuthoringMetadata,
  type CompositionTimelineMode,
  type CompositionTransportMode,
  type CompositionTimelineDocument,
  type CompositionTimelineContent,
  type CompositionTimelineFit,
  type CompositionTimelineLayout,
  type CompositionTimelinePlacement,
  type CompositionTimelineRect,
  type CompositionTimelineShapeKind,
  type CompositionDocumentMetadata,
  type CompositionKind,
  type CompositionOutputKind,
  type CompositionSetup,
  type CompositionSetupContext,
  type CompositionFrameState,
  type CompositionFrameListener,
  type DefineCompositionOptions,
} from "./composition";
export {
  defineVideoPlane3DComposition,
  type VideoPlane3DCompositionOptions,
} from "./compositions/videoPlane3D";
export { escapeHtml, htmlAttributes, kebabCase } from "./compositions/html";
export {
  mountComposition,
  registerCanvasCapture,
  type CompositionHandle,
  type MountCompositionOptions,
} from "./runtime";
export { createPlayer, type PlayerHandle, type PlayerOptions } from "./player";
export {
  checkCompositionDeterminism,
  type CheckCompositionDeterminismOptions,
  type DeterminismFrameResult,
} from "./determinism";

// Framework-free math helpers for authored JavaScript.
export { interpolate, Easing, type EasingFn, type InterpolateOptions } from "./interpolate";
export { spring, type SpringConfig, type SpringOptions } from "./spring";
export { springR, measureSpringR, type SpringRConfig, type SpringROptions } from "./springRemotion";
export { mapNestedFrame } from "./nested";

// Production planning: plan comps → edit skeletons, drift, actuals sync, slot swaps.
export {
  PLANNING_STATUSES,
  parsePlanRows,
  parseScriptSheet,
  retimePlanRows,
  movePlanRow,
  insertPlanRow,
  deletePlanRow,
  setPlanRowSource,
  generateEditSkeleton,
  defineEditSkeleton,
  planDrift,
  applyPlanActuals,
  swapNestedComp,
  type PlanningStatus,
  type PlanRow,
  type ScriptSheetDocument,
  type ScriptSheetField,
  type ScriptSheetRow,
  type ScriptSheetSource,
  type PlanRowSource,
  type InsertPlanRowOptions,
  type GenerateEditSkeletonOptions,
  type PlanDrift,
  type PlanDriftRow,
} from "./planning";
// Element-level copy between comps: a moodboard card, cast entry, or script row moves
// as source, ids re-uniqued against the destination.
export { copyHtmlElementInto } from "./studio/htmlSource";
// Stock moodboard surface: project data (JSON) in, package-owned canvas UX out.
export {
  defineMoodboardComposition,
  type MoodboardData,
  type MoodboardItem,
  type MoodboardCamera,
  type MoodboardOptions,
} from "./compositions/moodboard";

// Generative compositions — a recipe (prompt/refs/params) as source, takes as the lockfile.
export {
  generative,
  genMode,
  genEndpoint,
  genDims,
  genNativeDims,
  genOutputKindOf,
  genTakesFrom,
  recipeCanonical,
  recipeHashOf,
  genRecipeSnapshotOf,
  forkGenRecipe,
  invalidateGenManifest,
  GEN_DEFAULTS,
  type GenRecipe,
  type GenRecipeSnapshot,
  type GenRecipeData,
  type GenDesiredOutput,
  genRecipeDataOf,
  type GenInputProvenance,
  type GenRef,
  type GenRefKind,
  type GenMode,
  type GenTake,
  type GenProvenance,
  type GenerativeComposition,
} from "./generative";

export type {
  CompMeta,
  CompRegistry,
  StudioComposition,
  TimelineItem,
  ItemContent,
  Lane,
  DeclaredLane,
  CacheEntry,
  ArtifactMeta,
} from "./studio/types";
export type { StudioGuideDescriptor, StudioGuideStep, StudioGuideTarget } from "@framediff/studio-model";

// Effect tier: pure renderers attach to ordinary authored canvases through registerCanvasCapture.
export { gradeLayerFilter, gradeLayerVignette } from "./effects/gradeLayerCss";
export {
  createGradeVideoSetup,
  createVideoPlane3DSetup,
  type GradeVideoSetupOptions,
  type VideoPlane3DSetupOptions,
} from "./effects/htmlVideoEffects";
export { createGradeRenderer, type GradeParams, type GradeRenderer, type GradeSource } from "./effects/grade";
export { gradeDataAttributes, applyGradeDataAttributes } from "./effects/gradeAttributes";
export {
  applyVideoLook,
  createNamedVideoLookSetup,
  videoLookKey,
  type NamedVideoLookSetupOptions,
  type VideoLook,
} from "./effects/videoLook";
export {
  clipMotion2DFromDocument,
  createAudioFadeOutSetup,
  createCharacterRiseSetup,
  createClipMotionSetup,
  createSplitScreenRevealSetup,
  createWipeRevealSetup,
  evaluateClipMotion2D,
  evaluateSplitScreenRevealEdge,
  type AudioFadeOutSetupOptions,
  type AudioFadeOutSettings,
  type CharacterRiseSetupOptions,
  type ClipMotion2D,
  type ClipMotion2DDocument,
  type ClipMotionPathPoint,
  type ClipMotionSetupOptions,
  type SplitScreenRevealMapping,
  type SplitScreenRevealSetupOptions,
  type WipeRevealSetupOptions,
} from "./effects/domTimelineEffects";
export { parseCubeLUT, generateWarmGoldLUT, lutToRGBA8, type LUT3D } from "./effects/lut";
export { squareToQuad, invert3x3, applyMat3, cornerPinInverse, type Mat3 } from "./effects/homography";
export { createScene3DRenderer, type Plane3DParams, type DofParams, type Scene3DRenderer, type SceneSource } from "./effects/scene3d";
export {
  createClothSimulation,
  createClothRenderer,
  createClothSetup,
  type ClothVec3,
  type ClothUv,
  type ClothPins,
  type ClothVectorAtTime,
  type ClothImpulse,
  type ClothSphereCollider,
  type ClothCapsuleCollider,
  type ClothPlaneCollider,
  type ClothCollider,
  type ClothSimulationOptions,
  type ClothSimulation,
  type ClothCameraOptions,
  type ClothMaterialOptions,
  type ClothTransformOptions,
  type ClothRendererOptions,
  type ClothTextureSource,
  type ClothRenderer,
  type ClothTextureRefresh,
  type ClothSetupOptions,
} from "./effects/cloth";
export {
  cameraPoseAtFrame,
  cameraKeyframesFromProgress,
  interpolateVirtualCameraPose,
  monotoneCubic,
  type CameraPoseAtFrameOptions,
  type Plane3DTransform,
  type VirtualCameraPose,
  type CameraKeyframe,
  type CameraInterpolation,
  type CameraKeyframesFromProgressOptions,
  type CameraProgressCurve,
} from "./effects/camera";
export { perspective, lookAt, multiply, type M4, type V3 } from "./effects/mat4";
export { aeEaseInfluence } from "./effects/ease";

// After Effects interop.
export {
  aeEase,
  aeFindComp,
  aeProp,
  aeValue,
  aeSourceTime,
  aeVisibleWindows,
  aeCameraShot,
  type AeDump,
  type AeComp,
  type AeLayer,
  type AeProperty,
  type AeKey,
  type AeVisibleWindow,
  type AeCameraShot,
  type AeCameraShotInput,
} from "./ae/aeImport";

// Deterministic render pipeline.
export {
  exportVideo,
  exportVideoToFileSystemWritable,
  exportVideoToSink,
  exportVideoToWritable,
  type ExportOptions,
  type ExportPhase,
  type ExportProgress,
  type ExportVideoFileSystemOptions,
  type ExportVideoSinkOptions,
  type ExportVideoStreamResult,
  type ExportVideoWritableOptions,
} from "./render/exportVideo";
export { createAppendWritableSink, createFileSystemWritableSink, type ExportChunkSink } from "./render/exportSinks";
export { renderFrameToCanvas, type RenderFrameOptions } from "./render/renderFrame";
export { captureCompositeFrame, type CaptureFrameOptions } from "./render/captureComposite";
export { isAudioElementActive, isTimelineElementActive, isVisualElementActive } from "./render/activeElement";
export { downloadBuffer } from "./save";

// Build graph and content-addressed artifacts.
export { canonicalJSON } from "./graph/canonicalJSON";
export { hashBytes, hashString, hashCanonical, hashBlob, type Hash } from "./graph/hash";
export { fingerprint, type Toolchain, type ResolvedInput, type BuildNode } from "./graph/fingerprint";
export {
  validateAssetManifest,
  validateLockfile,
  validateJobRecord,
  type AssetManifest,
  type AssetEntry,
  type Lockfile,
  type LockEntry,
  type JobRecord,
  type JobStatus,
  type ValidationResult,
} from "./graph/schemas";

export { createAssetResolver, preloadAssetResolver, type AssetResolver, type ResolvedAsset, type AssetResolverOptions } from "./assets/resolver";
export { MemoryCAS, type CAS } from "./assets/cas";
export { HttpFolderCAS } from "./assets/httpCas";
export { loadManifest } from "./assets/manifest";

export { defineComposition as defineBuildComposition, plan, Artifact, type BuildContext, type CompositionDef, type PlanNode } from "./graph/planner";
export { validateGraph, topoSort, resolveGraph, type Baker, type ResolveOptions, type ResolvedNode } from "./graph/scheduler";
export { resolveBakeResolution, type MediaBundle, type BakeResolution } from "./nodes/mediaBundle";
export {
  createPrecompBaker,
  createAssetBaker,
  resolveComposition,
  type PrecompBakerDeps,
  type ResolveCompositionOptions,
} from "./nodes/precomp";
