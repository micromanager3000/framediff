import type { RenderProgressSnapshot, RenderResult } from "./types";

/**
 * Provider-neutral contracts for a render that may execute outside the browser.
 *
 * These types deliberately contain no provider, transport, credential, or hosted
 * service details. A hosted adapter can implement the backend while the Studio
 * only observes a durable job and its content-addressed result.
 */

export type RenderOutputKind = "video" | "image" | "audio";

export type RemoteRenderPhase = "queued" | "starting" | "rendering" | "uploading";
export type RemoteRenderTerminalState = "succeeded" | "failed" | "cancelled";
export type RemoteRenderState = RemoteRenderPhase | RemoteRenderTerminalState;

export interface RenderAssetInput {
  id: string;
  contentHash: string;
  mime: string;
  bytes: number;
}

export interface RenderSourceRevision {
  /** An immutable project revision, never a mutable branch or workspace label. */
  revision: string;
  /** Immutable identity of the complete source bundle consumed by the renderer. */
  bundleIdentity: string;
  /** Hashes are enough for the request fingerprint; files are resolved by the adapter. */
  files: Record<string, string>;
}

export interface RenderRational {
  numerator: number;
  denominator: number;
}

export interface RenderSettings {
  width: number;
  height: number;
  /** Exact frame rate; decimal FPS values are not sufficient for render identity. */
  fps: RenderRational;
  from: number;
  to: number;
  outputKind: RenderOutputKind;
  /** Every field below can change output bytes and is therefore fingerprinted. */
  codec: string;
  bitrate: number;
  colorProfile: string;
  /** Settings that affect bytes but are not part of the common render shape. */
  options?: Record<string, string | number | boolean | null>;
}

export interface RenderRequest {
  version: 1;
  /** Stable project identity; this is not an authorization or tenant claim. */
  projectId: string;
  compositionKey: string;
  source: RenderSourceRevision;
  assets: RenderAssetInput[];
  settings: RenderSettings;
  /** Public FrameDiff source revision used to interpret the project bundle. */
  frameDiffRevision: string;
  /** Immutable renderer image/runtime identity, normally an image digest. */
  workerImageDigest: string;
  engineRevision: string;
  runtimeIdentity: string;
  /** Identity of the fonts resolved by the renderer, including versions/bytes. */
  fontIdentity: string;
}

export interface RenderArtifactMetadata {
  contentHash: string;
  filename: string;
  mime: string;
  bytes: number;
  dimensions?: { width: number; height: number };
  durationSeconds?: number;
}

export interface RenderProvenance {
  fingerprint: string;
  projectId: string;
  compositionKey: string;
  sourceRevision: string;
  bundleIdentity: string;
  assetHashes: string[];
  settings: RenderSettings;
  frameDiffRevision: string;
  workerImageDigest: string;
  engineRevision: string;
  runtimeIdentity: string;
  fontIdentity: string;
}

export interface SanitizedRenderError {
  code: string;
  message: string;
  retryable?: boolean;
}

/** A local render result can omit artifact/provenance; remote results should provide them. */
export interface RenderResultMetadata {
  artifact: RenderArtifactMetadata;
  provenance: RenderProvenance;
}

export interface RemoteRenderSubmission {
  jobId: string;
  state?: RemoteRenderState;
  progress?: RenderProgressLike;
}

export interface RemoteRenderStatus {
  jobId: string;
  state: RemoteRenderState;
  progress?: RenderProgressLike;
  result?: RenderResultLike;
  error?: SanitizedRenderError;
}

export interface RenderProgressLike {
  phase: RemoteRenderPhase;
  completed: number;
  total: number;
  jobId?: string;
  message?: string;
}

export interface RenderResultLike {
  bytes: number;
  filename: string;
  metadata?: RenderResultMetadata;
}

export interface RemoteRenderBackend {
  submit(request: RenderRequest): Promise<RemoteRenderSubmission>;
  getStatus(jobId: string): Promise<RemoteRenderStatus>;
  cancel(jobId: string): Promise<void>;
}

export type RemoteRenderRequestFactory = (compositionKey: string) => Promise<RenderRequest>;

export interface RemoteRenderExecutorOptions extends WaitForRemoteRenderOptions {}

export interface WaitForRemoteRenderOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class RemoteRenderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean | undefined;
  public readonly jobId: string | undefined;

  public constructor(error: SanitizedRenderError, jobId?: string) {
    super(error.message);
    this.name = "RemoteRenderError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.jobId = jobId;
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`render request contains a non-finite number: ${String(value)}`);
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((entry) => {
    const child = canonicalize(entry);
    if (child === undefined) throw new Error("render request arrays cannot contain undefined values.");
    return child;
  });
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().flatMap((key) => {
      const child = canonicalize((value as Record<string, unknown>)[key]);
      return child === undefined ? [] : [[key, child]];
    }));
  }
  throw new Error(`Cannot canonicalize ${typeof value} in a render request.`);
}

function canonicalRational(value: RenderRational): RenderRational {
  if (!Number.isInteger(value.numerator) || value.numerator <= 0 || !Number.isInteger(value.denominator) || value.denominator <= 0) {
    throw new Error("render request FPS must use positive integer numerator and denominator values");
  }
  let left = value.numerator;
  let right = value.denominator;
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return { numerator: value.numerator / left, denominator: value.denominator / left };
}

/** Stable JSON used by adapters when deriving an idempotency/cache key. */
export function canonicalRenderRequest(request: RenderRequest): string {
  return JSON.stringify(canonicalize({
    ...request,
    settings: { ...request.settings, fps: canonicalRational(request.settings.fps) },
    assets: [...request.assets].sort((a, b) =>
      `${a.id}\u0000${a.contentHash}\u0000${a.mime}\u0000${a.bytes}`.localeCompare(`${b.id}\u0000${b.contentHash}\u0000${b.mime}\u0000${b.bytes}`)),
  }));
}

export async function fingerprintRenderRequest(request: RenderRequest): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRenderRequest(request)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Convert arbitrary adapter failures into a safe, user-facing error boundary. */
export function sanitizeRenderError(error: unknown): SanitizedRenderError {
  const structured = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : undefined;
  const raw = error instanceof Error
    ? error.message
    : typeof structured?.message === "string"
      ? structured.message
      : String(error);
  const message = raw
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, "Authorization: Bearer [redacted]")
    .replace(/\bBearer\s+(?!\[redacted\])[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/(x-api-key|api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]")
    .replace(/\bAuthorization\s*:\s*(?!Bearer\s)(?!\[redacted\])[^\s,;]+/gi, "Authorization: [redacted]")
    .replace(/([?&](?:token|api[-_ ]?key|secret|password)=)[^&\s]+/gi, "$1[redacted]");
  return {
    code: error instanceof RemoteRenderError ? error.code : typeof structured?.code === "string" ? structured.code : "remote-render-failed",
    message: message || "Remote render failed.",
    ...(typeof structured?.retryable === "boolean" ? { retryable: structured.retryable } : {}),
  };
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function progressFor(status: RemoteRenderStatus | RemoteRenderSubmission, jobId: string): RenderProgressLike {
  return status.progress ?? { phase: status.state === "queued" ? "queued" : status.state === "starting" ? "starting" : status.state === "uploading" ? "uploading" : "rendering", completed: 0, total: 1, jobId };
}

async function waitForRemoteRender(
  backend: RemoteRenderBackend,
  jobId: string,
  onProgress: (progress: RenderProgressLike) => void,
  options: WaitForRemoteRenderOptions = {},
): Promise<RenderResultLike> {
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  let highestPhase = -1;
  const phaseRank: Record<RemoteRenderPhase, number> = { queued: 0, starting: 1, rendering: 2, uploading: 3 };
  for (;;) {
    if (options.signal?.aborted) {
      try {
        await backend.cancel(jobId);
      } catch {
        // The caller already asked for cancellation; a provider-side cancel race must
        // not replace the stable cancellation result with a transport error.
      }
      throw new RemoteRenderError({ code: "cancelled", message: "Remote render was cancelled." }, jobId);
    }
    const status = await backend.getStatus(jobId);
    if (status.jobId !== jobId) {
      throw new RemoteRenderError({ code: "stale-status", message: "Remote render status belonged to a different job." }, jobId);
    }
    if (status.state in phaseRank && phaseRank[status.state as RemoteRenderPhase] < highestPhase) {
      await sleep(pollIntervalMs);
      continue;
    }
    if (status.state in phaseRank) highestPhase = Math.max(highestPhase, phaseRank[status.state as RemoteRenderPhase]);
    onProgress({ ...progressFor(status, jobId), jobId });
    if (status.state === "succeeded") {
      if (!status.result) throw new RemoteRenderError({ code: "invalid-result", message: "Remote render completed without an artifact." }, jobId);
      return status.result;
    }
    if (status.state === "failed" || status.state === "cancelled") {
      throw new RemoteRenderError(sanitizeRenderError(status.error ?? { code: status.state, message: `Remote render ${status.state}.` }), jobId);
    }
    await sleep(pollIntervalMs);
  }
}

/** Submit a job and wait for its durable result. The job id is included in progress events. */
export async function executeRemoteRender(
  backend: RemoteRenderBackend,
  request: RenderRequest,
  onProgress: (progress: RenderProgressLike) => void,
  options: WaitForRemoteRenderOptions = {},
): Promise<RenderResultLike> {
  let submission: RemoteRenderSubmission | undefined;
  try {
    submission = await backend.submit(request);
    onProgress({ ...progressFor(submission, submission.jobId), jobId: submission.jobId });
    return await waitForRemoteRender(backend, submission.jobId, onProgress, options);
  } catch (error) {
    if (error instanceof RemoteRenderError) throw error;
    throw new RemoteRenderError(sanitizeRenderError(error), submission?.jobId);
  }
}

/**
 * Adapt a remote backend to the existing RenderManager callback seam. Local browser
 * rendering continues to use the workspace callback; hosted adapters can inject the
 * returned function only when they have an immutable request factory.
 */
export function createRemoteRenderExecutor(
  backend: RemoteRenderBackend,
  requestForComposition: RemoteRenderRequestFactory,
  options: RemoteRenderExecutorOptions = {},
): ((compositionKey: string, onProgress: (progress: RenderProgressSnapshot) => void) => Promise<RenderResult>) & { cancel(jobId: string): Promise<void> } {
  return Object.assign(
    async (compositionKey: string, onProgress: (progress: RenderProgressSnapshot) => void) => {
      const request = await requestForComposition(compositionKey);
      const result = await executeRemoteRender(backend, request, onProgress, options);
      return {
        bytes: result.bytes,
        filename: result.filename,
        artifact: result.metadata?.artifact,
        provenance: result.metadata?.provenance,
      };
    },
    { cancel: (jobId: string) => backend.cancel(jobId) },
  );
}

/** Resume observing a previously submitted job without creating a second job. */
export function resumeRemoteRender(
  backend: RemoteRenderBackend,
  jobId: string,
  onProgress: (progress: RenderProgressLike) => void,
  options?: WaitForRemoteRenderOptions,
): Promise<RenderResultLike> {
  return waitForRemoteRender(backend, jobId, onProgress, options).catch((error) => {
    if (error instanceof RemoteRenderError) throw error;
    throw new RemoteRenderError(sanitizeRenderError(error), jobId);
  });
}
