import type { CanonicalTweenKind, NormalizedTweenOperation, ParamBinding } from "./animation";
import type { VisualAdaptation, VisualGeometryClassification } from "./generativeGeometry";
import type { CubicMotionSegment, GestureSample } from "./motionPath";

export type CompositionKind = "edit" | "custom" | "3d" | "generate" | "audio" | "doc" | "plan" | "scene" | "board" | "moodboard" | "script" | "storyboard" | "locations" | "cast";
export type CompositionOutputKind = "video" | "image" | "audio";
export type CompositionTimelineMode = "auto" | "always" | "hidden";
export type CompositionTransportMode = "auto" | "always" | "hidden";

export interface CompositionAuthoringDescriptor {
  timeline?: CompositionTimelineMode;
  transport?: CompositionTransportMode;
  directManipulation?: boolean;
}

/** A source-declared, project-specific route into a real Studio workflow. */
export interface StudioGuideTarget {
  compositionKey: string;
  frame?: number;
  selection?: {
    kind: "clip" | "element" | "animation";
    objectId: string;
    ownerItemId?: string;
  };
  panel?: "inspector" | "code" | "media" | "cache" | "agent";
}

export interface StudioGuideStep {
  id: string;
  phase: string;
  title: string;
  description: string;
  /** Concrete user action to perform after opening the target. */
  try: string;
  /** Observable result that tells a new user the feature worked. */
  success: string;
  target: StudioGuideTarget;
}

/** Optional source metadata that turns a project into an in-product, persistent walkthrough. */
export interface StudioGuideDescriptor {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes?: number;
  steps: StudioGuideStep[];
}

/** Stable identity shared by canvas, timeline, Inspector, code, agents, and provenance views. */
export type ProjectObjectKind =
  | "element"
  | "clip"
  | "effect"
  | "animation"
  | "asset"
  | "artifact"
  | "generator";

export interface ProjectObjectRef {
  compositionKey: string;
  objectId: string;
  kind: ProjectObjectKind;
}

/** Why a projected value can or cannot be rewritten by the Studio. */
export type PropertyAuthority = "literal" | "shared" | "computed" | "opaque";

export interface SourceFileRevisionSnapshot {
  file: string;
  /** Null means the file did not exist at this side of the transaction. */
  text: string | null;
  /** SHA-256 of text, or null for a missing file. */
  hash: string | null;
}

/** Exact reversible result of one atomic source transaction. */
export interface ProjectEditReceipt {
  id: string;
  label: string;
  groupId?: string;
  before: SourceFileRevisionSnapshot[];
  after: SourceFileRevisionSnapshot[];
}

export interface ProjectEditConflict {
  file: string;
  expectedHash: string | null;
  actualHash: string | null;
}

export interface ProjectEditResult {
  ok: boolean;
  receipt?: ProjectEditReceipt;
  conflicts?: ProjectEditConflict[];
  message?: string;
}

export type ProjectEditListener = (receipt: ProjectEditReceipt) => void;

export interface CompositionDescriptor {
  key: string;
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  kind: CompositionKind;
  outputKind: CompositionOutputKind;
  file?: string;
  /** True when this composition has an external JSON timeline that can own layout and shapes. */
  timelineDocument?: boolean;
  /** Complete source/dependency set used for revision guards and artifact fingerprints. */
  sources?: string[];
  library?: boolean;
  /** Render window: only [from, to) ships; absent = the whole comp. */
  render?: { from: number; to: number };
  /** Optional project walkthrough. The first declared guide is available from every composition. */
  guide?: StudioGuideDescriptor;
  /** Composition-owned authoring capabilities; the Svelte app remains the owner of global chrome. */
  authoring?: CompositionAuthoringDescriptor;
}

export interface ColorGradeEffectSnapshot {
  type: "color-grade";
  grade?: Record<string, number>;
  lut?: "gold" | "custom";
  lutIntensity?: number;
  lutName?: string;
}

export type TimelineContentSnapshot =
  | { type: "nested"; compId: string; nestedScale?: number; trimStart: number; playbackRate?: number; volume?: number; muted?: boolean; effects?: ColorGradeEffectSnapshot[] }
  | { type: "video"; src: string; trimStart?: number; playbackRate?: number; volume?: number; muted?: boolean; effects?: ColorGradeEffectSnapshot[] }
  | { type: "image"; src: string }
  | { type: "audio"; src: string; trimStart?: number; playbackRate?: number; volume?: number; muted?: boolean }
  | { type: "shape"; shape: "rect" | "ellipse" | "line" | "polygon" | "path" }
  | { type: "layers"; label: string; effects?: ColorGradeEffectSnapshot[] }
  | { type: "camera"; camera: string; effects?: ColorGradeEffectSnapshot[] }
  | { type: "grade-layer"; effects?: ColorGradeEffectSnapshot[] };

export interface TimelineItemSnapshot {
  id: string;
  from: number;
  durationInFrames: number;
  name?: string;
  content: TimelineContentSnapshot;
  order: number;
  /** Explicit authored visual/audio track rank. Undefined means legacy DOM-order fallback. */
  layer?: number;
  origin: "sequence" | "media";
  editable?: {
    from: boolean;
    duration: boolean;
    layer?: boolean;
    trimStart?: boolean;
    delete?: boolean;
  };
  production?: {
    assetId?: string;
    contentHash?: string;
    availability?: "local" | "remote" | "missing";
    rendition?: "original" | "proxy";
    proxyContentHash?: string;
    nestedCompositionKey?: string;
    effects: boolean;
    artifactStatus?: "current" | "stale" | "missing" | "remote";
    pinnedTake?: number;
    sourceDurationSeconds?: number;
  };
}

export interface TimelineLaneSnapshot {
  id: string;
  label: string;
  kind: "video" | "audio" | "grade";
  layer?: number;
  authority: "explicit" | "legacy";
  items: TimelineItemSnapshot[];
}

export interface AnimationSourceSpanSnapshot {
  file?: string;
  start: number;
  end: number;
}

export interface AnimationTimingSnapshot {
  frame: number;
  authority: "frames" | "seconds" | "implicit";
}

/** Plain, frame-native projection of a registered source animation. */
export interface AnimationSnapshot {
  id: string;
  target: string;
  kind: CanonicalTweenKind;
  startFrame: number;
  durationInFrames: number;
  from?: Record<string, string | number | boolean>;
  to: Record<string, string | number | boolean>;
  ease?: string;
  bindings: Record<string, ParamBinding<string | number | boolean>>;
  authority: PropertyAuthority;
  editable: boolean;
  source: AnimationSourceSpanSnapshot;
  start: AnimationTimingSnapshot;
  duration: AnimationTimingSnapshot;
  motionPath?: MotionPathSnapshot;
}

export interface MotionPathSnapshot {
  path: string;
  segments: CubicMotionSegment[];
  autoRotate: boolean;
}

export interface AnimationDiagnosticSnapshot {
  code: "parse" | "opaque" | "unstable-id" | "implicit-value" | "nondeterministic";
  severity: "info" | "warning" | "error";
  message: string;
  source?: AnimationSourceSpanSnapshot;
}

export interface AnimationProbeSnapshot {
  animations: AnimationSnapshot[];
  diagnostics: AnimationDiagnosticSnapshot[];
  opaqueCallCount: number;
  unrollGroups?: UnrollGroupSnapshot[];
}

export interface UnrollGroupSnapshot {
  id: string;
  timeline: string;
  source: AnimationSourceSpanSnapshot;
  operations: NormalizedTweenOperation[];
  safe: boolean;
  issues: string[];
}

export interface UnrollGroupRequest {
  compositionKey: string;
  groupId: string;
}

export interface AgentSourceRevisionSnapshot {
  file: string;
  hash: string | null;
}

export interface AgentArtifactSnapshot {
  name: string;
  contentHash?: string;
  compId?: string;
  label?: string;
  bytes: number;
  inputs?: Record<string, string>;
  status: "current" | "stale" | "untracked";
}

export interface AgentAssetSnapshot extends AssetDescriptor {
  availability: "local" | "remote";
}

export interface AgentCompositionSnapshot {
  composition: CompositionDescriptor;
  objects: TimelineItemSnapshot[];
  animations: AnimationSnapshot[];
  animationDiagnostics: AnimationDiagnosticSnapshot[];
  opaqueAnimationCount: number;
  unrollGroups: UnrollGroupSnapshot[];
  sources: AgentSourceRevisionSnapshot[];
  artifacts: AgentArtifactSnapshot[];
}

/** Stable machine-readable view shared by browser agents, CLI/MCP adapters and the Studio. */
export interface AgentProjectSnapshot {
  schemaVersion: 1;
  revision: string;
  compositions: AgentCompositionSnapshot[];
  assets: AgentAssetSnapshot[];
  dirtyFiles: string[] | null;
}

export interface AgentCheckDiagnostic {
  code:
    | "missing-source"
    | "unstable-object"
    | "read-only-object"
    | "missing-asset"
    | "remote-asset"
    | "opaque-animation"
    | "read-only-animation"
    | "unsafe-unroll"
    | "stale-artifact"
    | "source-conflict";
  severity: "info" | "warning" | "error";
  message: string;
  compositionKey?: string;
  objectId?: string;
  file?: string;
}

export interface AgentCheckResult {
  ok: boolean;
  revision: string;
  diagnostics: AgentCheckDiagnostic[];
}

export interface AgentFrameSnapshot {
  compositionKey: string;
  frame: number;
  width: number;
  height: number;
  mime: "image/png";
  contentHash: string;
  dataUrl: string;
}

export type AgentSemanticCommand =
  | { type: "edit-placement"; compositionKey: string; itemId: string; patch: Partial<Pick<TimelineItemSnapshot, "from" | "durationInFrames" | "layer">> }
  | { type: "edit-element"; request: PreviewElementEditRequest }
  | { type: "edit-inspector"; request: InspectorFieldEditRequest }
  | { type: "apply-grade-preset"; compositionKey: string; itemId: string; presetId: string }
  | { type: "edit-animation"; request: AnimationEditRequest }
  | { type: "edit-animations"; requests: AnimationEditRequest[] }
  | { type: "create-animation"; request: AnimationCreateRequest }
  | { type: "edit-motion-path"; request: MotionPathEditRequest }
  | { type: "create-motion-path"; request: MotionPathCreateRequest }
  | { type: "unroll-animation-group"; request: UnrollGroupRequest }
  | { type: "set-render-window"; compositionKey: string; from: number; to: number }
  | { type: "undo" }
  | { type: "redo" };

export interface AgentCommandEnvelope {
  /** Revision returned by inspect(); a mismatch refuses the command before any write. */
  expectedRevision?: string;
  command: AgentSemanticCommand;
}

export interface AgentCommandResult {
  ok: boolean;
  beforeRevision: string;
  afterRevision: string;
  receipt?: ProjectEditReceipt;
  conflicts?: ProjectEditConflict[];
  message?: string;
  check: AgentCheckResult;
}

export type AnimationLiteral = string | number | boolean;

export type AnimationMutation =
  | { type: "timing"; startFrame?: number; durationInFrames?: number }
  | { type: "upsert-key"; property: string; frame: number; value: AnimationLiteral; ease?: string }
  | { type: "move-key"; property: string; frame: number; toFrame: number }
  | { type: "delete-key"; property: string; frame: number }
  | { type: "set-ease"; property: string; frame: number; ease?: string };

export interface AnimationEditRequest {
  compositionKey: string;
  animationId: string;
  mutation: AnimationMutation;
  label?: string;
  groupId?: string;
}

export interface AnimationCreateRequest {
  compositionKey: string;
  objectId: string;
  property: string;
  from: AnimationLiteral;
  to: AnimationLiteral;
  startFrame: number;
  durationInFrames?: number;
  ease?: string;
  label?: string;
}

export interface MotionPathEditRequest {
  compositionKey: string;
  animationId: string;
  path: string;
  label?: string;
  groupId?: string;
}

export interface MotionPathCreateRequest {
  compositionKey: string;
  objectId: string;
  path: string;
  startFrame: number;
  durationInFrames: number;
  label?: string;
}

export interface GestureDraftSnapshot {
  objectId: string;
  animationId?: string;
  status: "armed" | "recording" | "preview";
  startFrame: number;
  samples: GestureSample[];
  path?: string;
}

export interface PreviewOptions {
  frame: number;
  playing: boolean;
  gradeBypass?: boolean;
}

export interface PreviewElementProperties {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

export type PreviewElementPatch = Partial<Pick<PreviewElementProperties, "x" | "y" | "width" | "height">>;

export interface PreviewNodeSnapshot {
  ref: ProjectObjectRef;
  tagName: string;
  label: string;
  parentId?: string;
  ownerItemId?: string;
  nestedCompositionKey?: string;
  /** Element box in authored composition pixels before its own rotation. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Matching unrotated box relative to the preview host. */
  previewBounds: { x: number; y: number; width: number; height: number };
  /** Composition-axis delta to preview-pixel delta. */
  compositionToPreview: { a: number; b: number; c: number; d: number; e: number; f: number };
  /** Local resize-axis delta to preview-pixel delta. */
  localToPreview: { a: number; b: number; c: number; d: number; e: number; f: number };
  properties: PreviewElementProperties;
  text?: string;
  movable: boolean;
  resizable: boolean;
}

export interface PreviewElementEditRequest {
  compositionKey: string;
  objectId: string;
  patch: PreviewElementPatch;
  label?: string;
  groupId?: string;
}

export interface PreviewHandle {
  update(compositionKey: string, options: PreviewOptions): void;
  subscribeNodes?(listener: (nodes: PreviewNodeSnapshot[]) => void): () => void;
  hitTest?(clientX: number, clientY: number): PreviewNodeSnapshot | null;
  applyDraft?(objectId: string, patch: PreviewElementPatch): void;
  clearDraft?(objectId?: string): void;
  destroy(): void;
}

export type PlacementField = "from" | "durationInFrames" | "layer" | "trimStart";

export interface PlacementEditRequest {
  compositionKey: string;
  itemId: string;
  field: PlacementField;
  value: number;
}

export interface PlacementEditResult {
  ok: boolean;
  file?: string;
  message?: string;
  receipt?: ProjectEditReceipt;
  conflicts?: ProjectEditConflict[];
}

export interface TimelineDeleteRequest {
  compositionKey: string;
  itemIds: string[];
  /** Removing an entire lane also closes the vacated rank for later lanes of the same kind. */
  compactLayer?: {
    kind: TimelineLaneSnapshot["kind"];
    layer: number;
  };
}

export interface TimelineShapeCreateRequest {
  compositionKey: string;
  shape: "rect" | "ellipse" | "line" | "path";
  from: number;
}

export interface InspectorOptionSnapshot {
  value: string;
  label: string;
}

export type InspectorControlSnapshot =
  | { type: "number"; value: number; min?: number; max?: number; step?: number; unit?: string; slider?: boolean }
  | { type: "text"; value: string; multiline?: boolean; placeholder?: string }
  | { type: "boolean"; value: boolean }
  | { type: "color"; value: string; alpha?: boolean }
  | { type: "select"; value: string; options: InspectorOptionSnapshot[] }
  | { type: "font"; value: string; suggestions?: string[] }
  | { type: "asset"; value: string; accept?: "image" | "video" | "audio" | "any" }
  | { type: "gradient"; value: string; gradientType: "linear" | "radial" }
  | { type: "alignment"; value: string; options: InspectorOptionSnapshot[] }
  | { type: "vector"; value: string; labels: string[]; unit?: string };

export interface InspectorFieldSnapshot {
  id: string;
  label: string;
  value?: number;
  text?: string;
  boolean?: boolean;
  valueType?: "number" | "text" | "boolean";
  editable: boolean;
  step?: number;
  source?: string;
  control?: InspectorControlSnapshot;
}

export interface InspectorSectionSnapshot {
  id: string;
  title: string;
  kind?: "grade" | "camera" | "data";
  fields: InspectorFieldSnapshot[];
  presets?: { id: string; label: string }[];
  /** Optional expanded editor for effects or other controls that outgrow the inline Inspector. */
  editor?: {
    presentation: "modal" | "inline-modal";
    label: string;
    description?: string;
  };
}

export interface InspectorDetailsSnapshot {
  compositionKey: string;
  itemId: string;
  sections: InspectorSectionSnapshot[];
}

export interface InspectorFieldEditRequest {
  compositionKey: string;
  itemId: string;
  fieldId: string;
  value: number | string | boolean;
}

export interface InspectorFieldsEditRequest {
  compositionKey: string;
  itemId: string;
  edits: Array<Pick<InspectorFieldEditRequest, "fieldId" | "value">>;
  label?: string;
  groupId?: string;
}

/**
 * Runtime boundary implemented by the framework-free HTML composition integration.
 * The Studio model consumes plain snapshots and never sees authored DOM nodes.
 */
export interface CompositionRuntimePort {
  getCompositions(): CompositionDescriptor[];
  subscribeCompositions(listener: (compositions: CompositionDescriptor[]) => void): () => void;
  probe(compositionKey: string): Promise<TimelineItemSnapshot[]>;
  /** Optional registered-animation projection. Arbitrary runtime animation remains valid but opaque. */
  probeAnimations?(compositionKey: string): Promise<AnimationProbeSnapshot>;
  editAnimation?(request: AnimationEditRequest): Promise<PlacementEditResult>;
  editAnimations?(requests: AnimationEditRequest[]): Promise<PlacementEditResult>;
  createAnimation?(request: AnimationCreateRequest): Promise<PlacementEditResult>;
  editMotionPath?(request: MotionPathEditRequest): Promise<PlacementEditResult>;
  createMotionPath?(request: MotionPathCreateRequest): Promise<PlacementEditResult>;
  unrollAnimationGroup?(request: UnrollGroupRequest): Promise<PlacementEditResult>;
  /** Exact random-access PNG for agent visual feedback; optional in static/embed runtimes. */
  captureFrame?(compositionKey: string, frame: number): Promise<AgentFrameSnapshot>;
  editPlacement(request: PlacementEditRequest): Promise<PlacementEditResult>;
  editPlacements(requests: PlacementEditRequest[]): Promise<PlacementEditResult>;
  /** Remove source-backed timeline objects as one reversible source transaction. */
  deleteTimelineItems?(request: TimelineDeleteRequest): Promise<PlacementEditResult>;
  /** Add a JSON-authored vector shape to an edit timeline. */
  createTimelineShape?(request: TimelineShapeCreateRequest): Promise<PlacementEditResult>;
  /** Persist the render window (output t0 = from, output end = to); the full range clears it. */
  setRenderWindow(compositionKey: string, from: number, to: number): Promise<ProjectOperationResult>;
  inspectItem(compositionKey: string, itemId: string): Promise<InspectorDetailsSnapshot>;
  editInspectorField(request: InspectorFieldEditRequest): Promise<PlacementEditResult>;
  /** Atomically rewrite several Inspector literals, for example one XYZ gizmo gesture. */
  editInspectorFields?(request: InspectorFieldsEditRequest): Promise<PlacementEditResult>;
  applyGradePreset(compositionKey: string, itemId: string, presetId: string): Promise<PlacementEditResult>;
  editElementProperties?(request: PreviewElementEditRequest): Promise<PlacementEditResult>;
  mountPreview(host: HTMLElement, compositionKey: string, options: PreviewOptions): PreviewHandle;
  /** Optional for runtimes without a writable source bridge (for example static embeds). */
  subscribeProjectEdits?(listener: ProjectEditListener): () => void;
  /** Replay an exact receipt for conflict-safe undo/redo without inventing a second write path. */
  replayProjectEdit?(receipt: ProjectEditReceipt, direction: "undo" | "redo"): Promise<ProjectEditResult>;
}

export interface AssetDescriptor {
  id: string;
  name: string;
  /** Readable filename in the local cache, when the asset is available on disk. */
  filename?: string;
  mime: string;
  bytes: number;
  contentHash: string;
  /** Browser-compatible derivative used for inline preview; the original remains authoritative. */
  previewContentHash?: string;
  durationSeconds?: number;
}

export interface RenderProgressSnapshot {
  phase: "prepare" | "audio" | "render" | "finalize";
  completed: number;
  total: number;
}

export interface RenderResult {
  bytes: number;
  filename: string;
}

export interface CacheEntryDescriptor {
  name: string;
  filename?: string;
  contentHash?: string;
  size: number;
  mtimeMs: number;
  compId?: string;
  label?: string;
  createdAt?: string;
  inputs?: Record<string, string>;
}

/** The exact, content-addressed inputs used to decide whether a composition bake is current. */
export interface CompositionBakeInputsSnapshot {
  inputs: Record<string, string>;
  /** Declared source or asset inputs that cannot currently be resolved. */
  missing: string[];
}

export type NewCompositionKind = CompositionKind;
export interface NewCompositionRequest {
  name: string;
  kind: NewCompositionKind;
  durationInFrames: number;
  /** Required by the runtime when kind is generate. It becomes the composition's locked contract. */
  outputKind?: CompositionOutputKind;
}

export interface ProjectOperationResult {
  ok: boolean;
  message: string;
  compositionKey?: string;
  receipt?: ProjectEditReceipt;
  conflicts?: ProjectEditConflict[];
}

export interface GenerativeParamSnapshot {
  key: string;
  label: string;
  type: "enum" | "number";
  value: string | number | boolean;
  options?: (string | number | boolean)[];
  min?: number;
  max?: number;
  step?: number;
  enabled: boolean;
}

export interface GenerativeRefSnapshot {
  kind: string;
  src: string;
  label: string;
  contentHash?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  targetWidth?: number;
  targetHeight?: number;
  adaptation?: VisualAdaptation;
  geometry?: VisualGeometryClassification;
}
export interface GenerativeTakeSettingsSnapshot {
  model: string;
  modelName: string;
  outputKind: CompositionOutputKind;
  prompt: string;
  negativePrompt: string;
  acceptsNegativePrompt: boolean;
  mode: string;
  endpoint: string;
  costUsd: number;
  params: GenerativeParamSnapshot[];
  refs: GenerativeRefSnapshot[];
}
export interface GenerativeCompositionInputSnapshot {
  key: string;
  id: string;
  outputKind: CompositionOutputKind;
  width: number;
  height: number;
}
export interface GenerativeTakeSnapshot {
  take: number;
  assetId: string;
  contentHash: string;
  bytes: number;
  recipeHash: string;
  endpoint: string;
  seed?: number;
  at?: string;
  outputKind: CompositionOutputKind;
  settings?: GenerativeTakeSettingsSnapshot;
}
export interface GenerativeJobSnapshot {
  id: string;
  providerJobId?: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  take?: number;
  recipeHash?: string;
  at?: string;
  doneAt?: string;
}
export interface GenerativeWorkspaceSnapshot {
  compositionKey: string;
  recipeId: string;
  file?: string;
  model: string;
  modelName: string;
  outputKind: CompositionOutputKind;
  /** The selected model's native output dimensions. Visual outputs only. */
  nativeWidth?: number;
  nativeHeight?: number;
  /** Optional composition-level visual output contract and fitting rule. */
  desiredOutput?: {
    width: number;
    height: number;
    adaptation: VisualAdaptation;
    geometry: VisualGeometryClassification;
  };
  models: { id: string; name: string; vendor: string; baseline: string }[];
  prompt: string;
  negativePrompt: string;
  acceptsNegativePrompt: boolean;
  mode: string;
  endpoint: string;
  costUsd: number;
  params: GenerativeParamSnapshot[];
  refs: GenerativeRefSnapshot[];
  compositions: GenerativeCompositionInputSnapshot[];
  takes: GenerativeTakeSnapshot[];
  jobs: GenerativeJobSnapshot[];
  pinnedTake: number;
  liveHash: string;
  status: "never" | "running" | "failed" | "current" | "stale" | "unpinned";
  providerReady: boolean;
  providerName: string;
  /** Upstream generative inputs that must have an available pinned take before submit. */
  blockedReason?: string;
}

export interface ProviderCredentialSnapshot {
  provider: "fal" | "byteplus" | "midjourney" | "luma";
  name: string;
  envVar: string;
  description: string;
  integration: "active" | "credentials-only";
  set: boolean;
  last4?: string;
  source?: "file" | "env";
}

export interface ProviderCredentialsSnapshot {
  providers: ProviderCredentialSnapshot[];
  /** Local JSON path relative to the project root. Secret values are never included. */
  file: string;
}

export interface ProjectWorkspacePort {
  readSource(file: string): Promise<string | null>;
  listAssets(): Promise<AssetDescriptor[]>;
  uploadAsset(file: File): Promise<string | null>;
  getGitStatus(): Promise<string[] | null>;
  commit(message: string): Promise<string | null>;
  renderComposition(
    compositionKey: string,
    onProgress: (progress: RenderProgressSnapshot) => void,
  ): Promise<RenderResult>;
  listCacheEntries(): Promise<CacheEntryDescriptor[]>;
  /** Must use the same dependency traversal and hashes as `bakeComposition`. */
  getCompositionBakeInputs(compositionKey: string, outputKind?: CompositionOutputKind): Promise<CompositionBakeInputsSnapshot>;
  /** Signals non-source render-input changes such as an updated asset-manifest mapping. */
  subscribeBakeInputChanges?(listener: () => void): () => void;
  bakeComposition(
    compositionKey: string,
    onProgress: (progress: RenderProgressSnapshot) => void,
    outputKind?: CompositionOutputKind,
  ): Promise<RenderResult>;
  createComposition(request: NewCompositionRequest, relativeToKey: string): Promise<ProjectOperationResult>;
  copyComposition(compositionKey: string, options?: { library?: boolean }): Promise<ProjectOperationResult>;
  setCompositionLibrary(compositionKey: string, library: boolean): Promise<ProjectOperationResult>;
  nestComposition(targetKey: string, sourceKey: string, from: number): Promise<ProjectOperationResult>;
  deleteComposition(compositionKey: string): Promise<ProjectOperationResult>;
  getGenerativeWorkspace(compositionKey: string): Promise<GenerativeWorkspaceSnapshot | null>;
  updateGenerativeRecipe(compositionKey: string, patch: Record<string, unknown>): Promise<ProjectOperationResult>;
  submitGeneration(compositionKey: string): Promise<ProjectOperationResult>;
  pinGenerationTake(compositionKey: string, take: number): Promise<ProjectOperationResult>;
  startGenerationFromTake(compositionKey: string, take: number): Promise<ProjectOperationResult>;
  startGenerationFromJob(compositionKey: string, jobId: string): Promise<ProjectOperationResult>;
  getProviderCredentials(): Promise<ProviderCredentialsSnapshot>;
  configureProvider(provider: string, key: string): Promise<ProjectOperationResult>;
  clearProvider(provider: string): Promise<ProjectOperationResult>;
}

export type StudioRuntimePort = CompositionRuntimePort & ProjectWorkspacePort;

export interface AnimationClock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export interface StudioSessionState {
  compositions: CompositionDescriptor[];
  currentKey: string;
  path: string[];
  frame: number;
  playing: boolean;
  gradeBypass: boolean;
  selectedItemId: string | null;
  selection: ProjectObjectRef | null;
  timelineByComposition: Record<string, TimelineItemSnapshot[]>;
  animationsByComposition: Record<string, AnimationSnapshot[]>;
  animationDiagnosticsByComposition: Record<string, AnimationDiagnosticSnapshot[]>;
  animationOpaqueCountByComposition: Record<string, number>;
  autoKey: boolean;
  gestureDraft: GestureDraftSnapshot | null;
  unrollGroupsByComposition: Record<string, UnrollGroupSnapshot[]>;
  loading: boolean;
  editing: boolean;
  error: string | null;
  notice: string | null;
}
