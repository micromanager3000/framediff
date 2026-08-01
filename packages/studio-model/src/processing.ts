import { ObservableValue } from "./observable";
import type { ProjectOperationResult } from "./types";

export const PROCESSING_COMPOSITION_KIND = "processing" as const;
export const PROCESSING_RECIPE_VERSION = 1 as const;
export const PROCESSING_ARTIFACT_VERSION = 1 as const;
export const RVM_PROCESSOR = "rvm" as const;
export const RVM_FOREGROUND_CHANNEL = "foreground" as const;
export const RVM_MATTE_CHANNEL = "matte" as const;

export type ProcessingScalar = string | number | boolean | null;
export type ProcessingParameters = Record<string, ProcessingScalar | ProcessingScalar[]>;

export interface ProcessingInput {
  name: string;
  contentHash: string;
  mime?: string;
}

export interface ProcessingProvenance {
  processor: string;
  model: string;
  modelRevision: string;
  runtime: string;
  runtimeRevision: string;
}

/** Versioned, provider-neutral description of one explicit processing operation. */
export interface ProcessingRecipe {
  version: typeof PROCESSING_RECIPE_VERSION;
  kind: typeof PROCESSING_COMPOSITION_KIND;
  id: string;
  inputs: ProcessingInput[];
  parameters: ProcessingParameters;
  provenance: ProcessingProvenance;
}

export interface ProcessingChannelTiming {
  fps: number;
  frameCount: number;
  durationSeconds?: number;
}

export interface ProcessingChannelDescriptor {
  name: string;
  contentHash: string;
  mime: string;
  container?: string;
  bytes: number;
  dimensions?: { width: number; height: number };
  dtype?: string;
  shape?: number[];
  timing?: ProcessingChannelTiming;
}

/** All channels are independently addressable; previews are not authoritative by convention. */
export interface ProcessingArtifactManifest {
  version: typeof PROCESSING_ARTIFACT_VERSION;
  kind: "processing-artifact";
  recipeFingerprint: string;
  inputs: ProcessingInput[];
  provenance: ProcessingProvenance;
  channels: Record<string, ProcessingChannelDescriptor>;
}

/** Source-owned processing state. Artifacts are immutable; changing a recipe clears its pin. */
export interface ProcessingCompositionDocument {
  recipe: ProcessingRecipe;
  /** Fingerprint of `recipe`; writers update this atomically with recipe changes. */
  recipeFingerprint: string | null;
  artifact: ProcessingArtifactManifest | null;
  pinnedRecipeFingerprint: string | null;
}

export type ProcessingStatus = "missing" | "running" | "current" | "stale" | "failed";

export interface ProcessingWorkspaceSnapshot {
  compositionKey: string;
  recipe: ProcessingRecipe;
  artifact: ProcessingArtifactManifest | null;
  pinnedRecipeFingerprint: string | null;
  /** Optional adapter-provided fingerprint of the currently selected recipe. */
  recipeFingerprint?: string;
  status: ProcessingStatus;
  error?: string;
}

export interface ProcessingOperationResult extends ProjectOperationResult {
  manifest?: ProcessingArtifactManifest;
  jobId?: string;
}

export interface ProcessingWorkspacePort {
  getProcessingWorkspace(compositionKey: string): Promise<ProcessingWorkspaceSnapshot | null>;
  runProcessing(compositionKey: string): Promise<ProcessingOperationResult>;
  pinProcessingArtifact(compositionKey: string, recipeFingerprint: string): Promise<ProcessingOperationResult>;
}

export interface ProcessingChannelResolution {
  ok: boolean;
  channel?: ProcessingChannelDescriptor;
  message?: string;
}

/** Stable reference suitable for persisting a named-channel selection in another composition. */
export interface ProcessingChannelPin {
  compositionKey: string;
  channelName: string;
  recipeFingerprint: string;
  contentHash: string;
  mime: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateInput(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value.name !== "string" || !value.name) errors.push(`${path}.name must be a non-empty string`);
  if (!validHash(value.contentHash)) errors.push(`${path}.contentHash must be a non-empty string`);
  if (value.mime !== undefined && (typeof value.mime !== "string" || !value.mime)) errors.push(`${path}.mime must be a non-empty string if present`);
}

function validateInputs(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || !value.length) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  const names = new Set<string>();
  value.forEach((input, index) => {
    validateInput(input, `${path}[${index}]`, errors);
    if (isRecord(input) && typeof input.name === "string") {
      if (names.has(input.name)) errors.push(`${path} contains duplicate input name "${input.name}"`);
      names.add(input.name);
    }
  });
}

function validateParameters(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("recipe.parameters must be an object");
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const validScalar = entry === null || typeof entry === "string" || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry));
    const validArray = Array.isArray(entry) && entry.every((item) => item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)));
    if (!validScalar && !validArray) errors.push(`recipe.parameters.${key} must be a scalar or scalar array`);
  }
}

function validateProvenance(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of ["processor", "model", "modelRevision", "runtime", "runtimeRevision"]) {
    if (typeof value[key] !== "string" || !value[key]) errors.push(`${path}.${key} must be a non-empty string`);
  }
}

export function validateProcessingRecipe(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["recipe must be an object"];
  if (value.version !== PROCESSING_RECIPE_VERSION) errors.push("recipe.version must be 1");
  if (value.kind !== PROCESSING_COMPOSITION_KIND) errors.push("recipe.kind must be processing");
  if (typeof value.id !== "string" || !value.id) errors.push("recipe.id must be a non-empty string");
  validateInputs(value.inputs, "recipe.inputs", errors);
  validateParameters(value.parameters, errors);
  validateProvenance(value.provenance, "recipe.provenance", errors);
  return errors;
}

function validateChannel(value: unknown, name: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`artifact.channels.${name} must be an object`);
    return;
  }
  if (typeof value.name !== "string" || !value.name) errors.push(`artifact.channels.${name}.name must be a non-empty string`);
  else if (value.name !== name) errors.push(`artifact.channels.${name}.name must match its channel key`);
  if (!validHash(value.contentHash)) errors.push(`artifact.channels.${name}.contentHash must be a non-empty string`);
  if (typeof value.mime !== "string" || !value.mime) errors.push(`artifact.channels.${name}.mime must be a non-empty string`);
  if (value.container !== undefined && (typeof value.container !== "string" || !value.container)) errors.push(`artifact.channels.${name}.container must be a non-empty string if present`);
  if (!isFiniteNumber(value.bytes) || value.bytes < 0 || !Number.isInteger(value.bytes)) errors.push(`artifact.channels.${name}.bytes must be a non-negative integer`);
  if (value.dimensions !== undefined && (!isRecord(value.dimensions) || !isFiniteNumber(value.dimensions.width) || !isFiniteNumber(value.dimensions.height) || !Number.isInteger(value.dimensions.width) || !Number.isInteger(value.dimensions.height) || value.dimensions.width <= 0 || value.dimensions.height <= 0)) {
    errors.push(`artifact.channels.${name}.dimensions must contain positive integer width and height`);
  }
  if (value.dtype !== undefined && typeof value.dtype !== "string") errors.push(`artifact.channels.${name}.dtype must be a string if present`);
  if (value.shape !== undefined && (!Array.isArray(value.shape) || !value.shape.every((entry) => isFiniteNumber(entry) && entry > 0 && Number.isInteger(entry)))) errors.push(`artifact.channels.${name}.shape must be positive integers if present`);
  if (value.timing !== undefined) {
    const timing = value.timing;
    const validTiming = isRecord(timing)
      && isFiniteNumber(timing.fps)
      && timing.fps > 0
      && isFiniteNumber(timing.frameCount)
      && Number.isInteger(timing.frameCount)
      && timing.frameCount >= 0
      && (timing.durationSeconds === undefined || (isFiniteNumber(timing.durationSeconds) && timing.durationSeconds >= 0));
    if (!validTiming) errors.push(`artifact.channels.${name}.timing must contain positive fps and a non-negative integer frameCount`);
  }
  if (value.timing === undefined && (value.dtype === undefined || value.shape === undefined)) errors.push(`artifact.channels.${name} must describe tensor dtype/shape or media timing`);
}

export function validateProcessingArtifactManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["artifact manifest must be an object"];
  if (value.version !== PROCESSING_ARTIFACT_VERSION) errors.push("artifact.version must be 1");
  if (value.kind !== "processing-artifact") errors.push("artifact.kind must be processing-artifact");
  if (!validHash(value.recipeFingerprint)) errors.push("artifact.recipeFingerprint must be a non-empty string");
  validateInputs(value.inputs, "artifact.inputs", errors);
  validateProvenance(value.provenance, "artifact.provenance", errors);
  if (!isRecord(value.channels) || !Object.keys(value.channels).length) errors.push("artifact.channels must be a non-empty map");
  else Object.entries(value.channels).forEach(([name, channel]) => validateChannel(channel, name, errors));
  return errors;
}

/** RVM always produces a color foreground and a separately addressable opacity matte. */
export function validateRvmArtifactManifest(value: unknown): string[] {
  const errors = validateProcessingArtifactManifest(value);
  if (!isRecord(value)) return errors;
  const provenance = isRecord(value.provenance) ? value.provenance : null;
  if (provenance?.processor !== RVM_PROCESSOR) errors.push(`artifact.provenance.processor must be ${RVM_PROCESSOR}`);
  const channels = isRecord(value.channels) ? value.channels : {};
  const foreground = isRecord(channels[RVM_FOREGROUND_CHANNEL]) ? channels[RVM_FOREGROUND_CHANNEL] : null;
  const matte = isRecord(channels[RVM_MATTE_CHANNEL]) ? channels[RVM_MATTE_CHANNEL] : null;
  if (!foreground) errors.push(`artifact.channels.${RVM_FOREGROUND_CHANNEL} is required for RVM`);
  if (!matte) errors.push(`artifact.channels.${RVM_MATTE_CHANNEL} is required for RVM`);
  if (foreground && matte) {
    if (JSON.stringify(foreground.dimensions) !== JSON.stringify(matte.dimensions)) {
      errors.push("RVM foreground and matte dimensions must match");
    }
    if (JSON.stringify(foreground.timing) !== JSON.stringify(matte.timing)) {
      errors.push("RVM foreground and matte timing must match");
    }
  }
  return [...new Set(errors)];
}

/** Deterministic recipe bytes; object-key order and input declaration order do not affect it. */
export function canonicalProcessingRecipe(recipe: ProcessingRecipe): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
    return value;
  };
  return JSON.stringify(sort({ ...recipe, inputs: [...recipe.inputs].sort((a, b) => `${a.name}:${a.contentHash}`.localeCompare(`${b.name}:${b.contentHash}`)) }));
}

export async function fingerprintProcessingRecipe(recipe: ProcessingRecipe): Promise<string> {
  const errors = validateProcessingRecipe(recipe);
  if (errors.length) throw new Error(`Invalid processing recipe: ${errors.join("; ")}`);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalProcessingRecipe(recipe)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function resolvePinnedProcessingChannel(
  workspace: ProcessingWorkspaceSnapshot | null,
  channelName: string,
): ProcessingChannelResolution {
  if (!workspace) return { ok: false, message: "No processing composition is selected." };
  if (!channelName) return { ok: false, message: "A processing channel name is required." };
  if (workspace.status !== "current") {
    const action = workspace.status === "failed"
      ? "run processing again"
      : workspace.status === "running"
        ? "wait for processing to finish"
        : "run processing again";
    return { ok: false, message: `The processing workspace is ${workspace.status}; ${action} before using its channels.` };
  }
  if (!workspace.pinnedRecipeFingerprint) return { ok: false, message: "Run processing and pin an artifact before using its channels." };
  if (!workspace.artifact || workspace.artifact.recipeFingerprint !== workspace.pinnedRecipeFingerprint) return { ok: false, message: "The pinned processing artifact is stale; run processing again and pin the new artifact." };
  const artifactErrors = validateProcessingArtifactManifest(workspace.artifact);
  if (artifactErrors.length) return { ok: false, message: `The pinned processing artifact is invalid: ${artifactErrors.join("; ")}` };
  if (workspace.recipeFingerprint && workspace.recipeFingerprint !== workspace.pinnedRecipeFingerprint) return { ok: false, message: "The selected processing recipe changed; run processing again and pin the new artifact." };
  const recipeInputs = new Map(workspace.recipe.inputs.map((input) => [input.name, input.contentHash]));
  if (workspace.artifact.inputs.length !== recipeInputs.size || workspace.artifact.inputs.some((input) => recipeInputs.get(input.name) !== input.contentHash)) {
    return { ok: false, message: "The pinned processing inputs are stale; run processing again and pin the new artifact." };
  }
  const channel = workspace.artifact.channels[channelName];
  return channel ? { ok: true, channel } : { ok: false, message: `The pinned processing artifact has no channel named “${channelName}”.` };
}

export function resolvePinnedProcessingChannelPin(
  workspace: ProcessingWorkspaceSnapshot | null,
  channelName: string,
): { ok: true; pin: ProcessingChannelPin } | { ok: false; message: string } {
  const resolution = resolvePinnedProcessingChannel(workspace, channelName);
  if (!resolution.ok || !resolution.channel) return { ok: false, message: resolution.message ?? "The processing channel is unavailable." };
  return {
    ok: true,
    pin: {
      compositionKey: workspace!.compositionKey,
      channelName,
      recipeFingerprint: workspace!.pinnedRecipeFingerprint!,
      contentHash: resolution.channel.contentHash,
      mime: resolution.channel.mime,
    },
  };
}

export interface ProcessingManagerState {
  workspace: ProcessingWorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  message: string | null;
}

export class ProcessingManager {
  public readonly state = new ObservableValue<ProcessingManagerState>({ workspace: null, loading: false, busy: false, error: null, message: null });
  private refreshGeneration = 0;
  private operationGeneration = 0;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(private readonly compositionKey: () => string, private readonly workspacePort: ProcessingWorkspacePort) {}

  public start(subscribeSelection: (listener: () => void) => () => void): void {
    if (this.unsubscribe) return;
    let previous = "";
    this.unsubscribe = subscribeSelection(() => {
      const current = this.compositionKey();
      if (current === previous) return;
      previous = current;
      void this.refresh();
    });
    this.timer = setInterval(() => {
      if (this.state.get().workspace?.status === "running") void this.refresh();
    }, 3_000);
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.refreshGeneration += 1;
    this.operationGeneration += 1;
  }

  public async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const compositionKey = this.compositionKey();
    this.state.update((state) => ({ ...state, loading: true, error: null }));
    try {
      const workspace = await this.workspacePort.getProcessingWorkspace(compositionKey);
      if (generation !== this.refreshGeneration) return;
      if (compositionKey !== this.compositionKey()) {
        this.state.update((state) => ({ ...state, workspace: null, loading: false }));
        return;
      }
      this.state.update((state) => ({ ...state, workspace, loading: false, error: null }));
    } catch (error) {
      if (generation !== this.refreshGeneration) return;
      if (compositionKey !== this.compositionKey()) {
        this.state.update((state) => ({ ...state, workspace: null, loading: false }));
        return;
      }
      this.state.update((state) => ({ ...state, workspace: null, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  public async run(): Promise<boolean> {
    if (this.state.get().busy) return false;
    const compositionKey = this.compositionKey();
    const operationGeneration = ++this.operationGeneration;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    try {
      const result = await this.workspacePort.runProcessing(compositionKey);
      if (operationGeneration !== this.operationGeneration || compositionKey !== this.compositionKey()) {
        this.clearStaleOperation(operationGeneration);
        return false;
      }
      this.state.update((state) => ({ ...state, busy: false, message: result.ok ? result.message : null, error: result.ok ? null : result.message }));
      if (result.ok) await this.refresh();
      return result.ok;
    } catch (error) {
      if (operationGeneration !== this.operationGeneration || compositionKey !== this.compositionKey()) {
        this.clearStaleOperation(operationGeneration);
        return false;
      }
      this.state.update((state) => ({ ...state, busy: false, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  public async pin(recipeFingerprint = this.state.get().workspace?.artifact?.recipeFingerprint): Promise<boolean> {
    if (this.state.get().busy || !recipeFingerprint) return false;
    const currentFingerprint = this.state.get().workspace?.artifact?.recipeFingerprint;
    if (currentFingerprint && currentFingerprint !== recipeFingerprint) {
      this.state.update((state) => ({ ...state, error: "The selected processing artifact is stale; refresh before pinning." }));
      return false;
    }
    const currentWorkspace = this.state.get().workspace;
    if (currentWorkspace?.recipeFingerprint && currentWorkspace.recipeFingerprint !== recipeFingerprint) {
      this.state.update((state) => ({ ...state, error: "The selected processing recipe changed; refresh before pinning." }));
      return false;
    }
    const compositionKey = this.compositionKey();
    const operationGeneration = ++this.operationGeneration;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    try {
      const result = await this.workspacePort.pinProcessingArtifact(compositionKey, recipeFingerprint);
      if (operationGeneration !== this.operationGeneration || compositionKey !== this.compositionKey()) {
        this.clearStaleOperation(operationGeneration);
        return false;
      }
      this.state.update((state) => ({ ...state, busy: false, message: result.ok ? result.message : null, error: result.ok ? null : result.message }));
      if (result.ok) await this.refresh();
      return result.ok;
    } catch (error) {
      if (operationGeneration !== this.operationGeneration || compositionKey !== this.compositionKey()) {
        this.clearStaleOperation(operationGeneration);
        return false;
      }
      this.state.update((state) => ({ ...state, busy: false, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  private clearStaleOperation(operationGeneration: number): void {
    if (operationGeneration !== this.operationGeneration) return;
    this.state.update((state) => ({ ...state, busy: false, workspace: null, error: null, message: null }));
  }

  public resolveChannel(channelName: string): ProcessingChannelResolution {
    return resolvePinnedProcessingChannel(this.state.get().workspace, channelName);
  }
}
