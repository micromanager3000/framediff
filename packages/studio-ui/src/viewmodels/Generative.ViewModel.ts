import { derived, get, type Readable } from "svelte/store";
import type {
  AssetManager,
  GenerativeJobSnapshot,
  GenerativeManager,
  GenerativeManagerState,
  GenerativeWorkspaceSnapshot,
  AssetState,
} from "@framediff/studio-model";
import { observableStore } from "./store";

export interface GeneratingTakeView {
  id: string;
  take: number;
  status: Extract<GenerativeJobSnapshot["status"], "queued" | "running">;
}

export interface FailedTakeView {
  id: string;
  take: number;
  error: string;
  policyRejection: boolean;
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

export function failedTakeView(workspace: GenerativeWorkspaceSnapshot | null): FailedTakeView | null {
  const latest = workspace?.jobs.at(-1);
  if (!workspace || latest?.status !== "failed") return null;
  return {
    id: latest.id,
    take: latest.take ?? Math.max(0, ...workspace.takes.map((take) => take.take)) + 1,
    error: readableGenerationError(latest.error),
    policyRejection: latest.error?.includes("content_policy_violation") ?? false,
  };
}

export function generatingTakeViews(
  workspace: GenerativeWorkspaceSnapshot | null,
  submitting = false,
): GeneratingTakeView[] {
  if (!workspace) return [];
  let nextTake = Math.max(0, ...workspace.takes.map((take) => take.take)) + 1;
  const active = workspace.jobs
    .filter((job): job is GenerativeJobSnapshot & { status: "queued" | "running" } =>
      job.status === "queued" || job.status === "running")
    .map((job) => ({
      id: job.id,
      take: job.take ?? nextTake++,
      status: job.status,
    }));
  return submitting && !active.length
    ? [{ id: "submitting", take: nextTake, status: "queued" }]
    : active;
}

export interface GenerativeViewSnapshot extends GenerativeManagerState {
  assets: AssetState["assets"];
  generatingTakes: GeneratingTakeView[];
  failedTake: FailedTakeView | null;
  generationActive: boolean;
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
        failedTake: failedTakeView(generation.workspace),
        generationActive: generatingTakes.length > 0,
      };
    });
  }
  public update(patch: Record<string, unknown>) { return this.manager.update(patch); }
  public generate() { return this.manager.generate(); }
  public pin(take: number) { return this.manager.pin(take); }
  public startFrom(take: number) { return this.manager.startFrom(take); }
  public configure(provider: string, key: string) { return this.manager.configure(provider, key); }
  public removeRef(index: number) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace) return Promise.resolve(false);
    return this.update({ refs: workspace.refs.filter((_, current) => current !== index).map(({ kind, src }) => ({ kind, src })) });
  }
  public addAssetRef(assetId: string, kind: string) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace) return Promise.resolve(false);
    return this.update({ refs: [...workspace.refs.map(({ kind: refKind, src }) => ({ kind: refKind, src })), { kind, src: `asset://${assetId}` }] });
  }
  public addCompositionRef(compositionKey: string, kind: string) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace || compositionKey === workspace.compositionKey) return Promise.resolve(false);
    const src = `comp://${compositionKey}`;
    if (workspace.refs.some((ref) => ref.src === src)) return Promise.resolve(false);
    return this.update({ refs: [...workspace.refs.map(({ kind: refKind, src: refSrc }) => ({ kind: refKind, src: refSrc })), { kind, src }] });
  }
}
