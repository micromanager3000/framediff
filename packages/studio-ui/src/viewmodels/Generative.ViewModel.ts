import { derived, get, type Readable } from "svelte/store";
import type {
  AssetManager,
  GenerativeJobSnapshot,
  GenerativeManager,
  GenerativeManagerState,
  GenerativeTakeSnapshot,
  GenerativeWorkspaceSnapshot,
  AssetState,
  VisualAdaptation,
} from "@framediff/studio-model";
import { observableStore } from "./store";

export interface GeneratingTakeView {
  id: string;
  /** Server-assigned once accepted; local submit placeholders must not claim a number. */
  take?: number;
  status: Extract<GenerativeJobSnapshot["status"], "queued" | "running">;
}

export interface FailedTakeView {
  id: string;
  take: number;
  error: string;
  policyRejection: boolean;
  matchesCurrentRecipe: boolean;
}

export type HistoricalTakeView =
  | { kind: "generated"; take: number; generatedTake: GenerativeTakeSnapshot }
  | { kind: "failed"; take: number; failedTake: FailedTakeView };

export type GenerativePreviewSelection = { kind: "draft" } | { kind: "take"; take: number };

/** Keep preview selection explicit: a missing take never falls through to pinned output. */
export function normalizePreviewSelection(
  selection: GenerativePreviewSelection,
  workspace: GenerativeWorkspaceSnapshot | null,
): GenerativePreviewSelection {
  return selection.kind === "take" && !workspace?.takes.some((take) => take.take === selection.take)
    ? { kind: "draft" }
    : selection;
}

export function readableGenerationError(error?: string): string {
  if (!error) return "The provider could not complete this generation.";
  const encodedMessage = error.match(/"msg":("(?:\\.|[^"\\])*")/)?.[1];
  if (encodedMessage) {
    try {
      return JSON.parse(encodedMessage) as string;
    } catch {
      // Fall through to the provider's original error.
    }
  }
  return error.length > 280 ? `${error.slice(0, 277)}…` : error;
}

export function nextGenerationTake(workspace: GenerativeWorkspaceSnapshot | null): number {
  if (!workspace) return 1;
  return Math.max(
    0,
    ...workspace.takes.map((take) => take.take),
    ...workspace.jobs.map((job) => job.take ?? 0),
  ) + 1;
}

export function failedTakeViews(workspace: GenerativeWorkspaceSnapshot | null): FailedTakeView[] {
  if (!workspace) return [];
  let nextFallback = nextGenerationTake(workspace);
  return workspace.jobs
    .filter((job) => job.status === "failed")
    .map((job) => ({
      id: job.id,
      take: job.take ?? nextFallback++,
      error: readableGenerationError(job.error),
      policyRejection: job.error?.includes("content_policy_violation") ?? false,
      matchesCurrentRecipe: job.recipeHash === workspace.liveHash,
    }));
}

export function historicalTakeViews(
  workspace: GenerativeWorkspaceSnapshot | null,
  failures = failedTakeViews(workspace),
): HistoricalTakeView[] {
  if (!workspace) return [];
  return [
    ...workspace.takes.map((generatedTake) => ({
      kind: "generated" as const,
      take: generatedTake.take,
      generatedTake,
    })),
    ...failures.map((failedTake) => ({
      kind: "failed" as const,
      take: failedTake.take,
      failedTake,
    })),
  ].sort((left, right) => right.take - left.take);
}

export function generatingTakeViews(
  workspace: GenerativeWorkspaceSnapshot | null,
  submitting = false,
): GeneratingTakeView[] {
  if (!workspace) return [];
  const active = workspace.jobs
    .filter((job): job is GenerativeJobSnapshot & { status: "queued" | "running" } =>
      job.status === "queued" || job.status === "running")
    .map((job) => ({
      id: job.id,
      take: job.take,
      status: job.status,
    }));
  return submitting && !active.length
    ? [{ id: "submitting", status: "queued" }]
    : active;
}

export interface GenerativeViewSnapshot extends GenerativeManagerState {
  assets: AssetState["assets"];
  generatingTakes: GeneratingTakeView[];
  failedTakes: FailedTakeView[];
  generationActive: boolean;
}

export function referenceKindForMime(mime: string): "image" | "video" | "audio" | null {
  const family = mime.trim().toLocaleLowerCase().split("/", 1)[0];
  return family === "image" || family === "video" || family === "audio" ? family : null;
}

export class GenerativeViewModel {
  public readonly store: Readable<GenerativeViewSnapshot>;
  private readonly generationStore: Readable<GenerativeManagerState>;
  public constructor(private readonly manager: GenerativeManager, assets: AssetManager) {
    this.generationStore = observableStore(manager.state);
    this.store = derived([this.generationStore, observableStore(assets.state)], ([generation, assetState]) => {
      const generatingTakes = generatingTakeViews(generation.workspace, generation.submitting);
      return {
        ...generation,
        assets: assetState.assets,
        generatingTakes,
        failedTakes: failedTakeViews(generation.workspace),
        generationActive: generatingTakes.length > 0,
      };
    });
  }
  public update(patch: Record<string, unknown>) { return this.manager.update(patch); }
  public openDraft() { return this.manager.openDraft(); }
  public generate() { return this.manager.generate(); }
  public pin(take: number) { return this.manager.pin(take); }
  public startFrom(take: number) { return this.manager.startFrom(take); }
  public startFromJob(jobId: string) { return this.manager.startFromJob(jobId); }
  public configure(provider: string, key: string) { return this.manager.configure(provider, key); }
  private authoredRefs(workspace: GenerativeWorkspaceSnapshot) {
    return workspace.refs.map(({ kind, src, adaptation }) => ({
      kind,
      src,
      ...(adaptation ? { adapt: adaptation } : {}),
    }));
  }
  public removeRef(index: number) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace) return Promise.resolve(false);
    return this.update({ refs: this.authoredRefs(workspace).filter((_, current) => current !== index) });
  }
  public updateRefAdaptation(index: number, adaptation?: VisualAdaptation) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace || !workspace.refs[index]) return Promise.resolve(false);
    const refs = this.authoredRefs(workspace);
    refs[index] = {
      kind: refs[index].kind,
      src: refs[index].src,
      ...(adaptation ? { adapt: adaptation } : {}),
    };
    return this.update({ refs });
  }
  public addAssetRef(assetId: string, kind: string) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace) return Promise.resolve(false);
    return this.update({ refs: [...this.authoredRefs(workspace), { kind, src: `asset://${assetId}` }] });
  }
  public addCompositionRef(compositionKey: string, kind: string) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace || compositionKey === workspace.compositionKey) return Promise.resolve(false);
    const src = `comp://${compositionKey}`;
    if (workspace.refs.some((ref) => ref.src === src)) return Promise.resolve(false);
    return this.update({ refs: [...this.authoredRefs(workspace), { kind, src }] });
  }
}
