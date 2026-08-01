/**
 * Public, provider-neutral render contracts. The Studio model owns the UI
 * manager that consumes these types; this boundary exposes only the reusable
 * render seam to project adapters and hosted integrations.
 */
export {
  canonicalRenderRequest,
  createRemoteRenderExecutor,
  executeRemoteRender,
  fingerprintRenderRequest,
  RemoteRenderError,
  resumeRemoteRender,
  sanitizeRenderError,
  type RemoteRenderBackend,
  type RemoteRenderExecutorOptions,
  type RemoteRenderPhase,
  type RemoteRenderRequestFactory,
  type RemoteRenderState,
  type RemoteRenderStatus,
  type RemoteRenderSubmission,
  type RenderArtifactMetadata,
  type RenderAssetInput,
  type RenderOutputKind,
  type RenderProgressLike,
  type RenderRational,
  type RenderProvenance,
  type RenderRequest,
  type RenderResultLike,
  type RenderResultMetadata,
  type RenderSettings,
  type RenderSourceRevision,
  type SanitizedRenderError,
  type WaitForRemoteRenderOptions,
} from "@framediff/studio-model";
