import { ObservableValue } from "../observable";
import { errorMessage } from "../errors";
import { canNestComposition } from "../nesting";
import type {
  CacheEntryDescriptor,
  CompositionBakeInputsSnapshot,
  CompositionDescriptor,
  CompositionRuntimePort,
  NewCompositionRequest,
  ProjectOperationResult,
  ProjectWorkspacePort,
  RenderProgressSnapshot,
} from "../types";
import type { StudioSession } from "../StudioSession";
import { artifactStatusFromInputs } from "../timeline";

export type CompositionBakeStatus = "checking" | "current" | "stale" | "missing" | "untracked";

export interface CurrentCompositionBakeSnapshot {
  compositionKey: string;
  compositionId: string;
  status: CompositionBakeStatus;
  artifactCount: number;
  /** Newest artifact whose recorded inputs exactly match the current composition. */
  artifact?: CacheEntryDescriptor;
}

type ObservableProjectWorkspace = ProjectWorkspacePort & Pick<Partial<CompositionRuntimePort>, "subscribeProjectEdits">;

export async function compositionBakeSnapshot(
  composition: CompositionDescriptor,
  cache: CacheEntryDescriptor[],
  loadInputs: (compositionKey: string) => Promise<CompositionBakeInputsSnapshot>,
): Promise<CurrentCompositionBakeSnapshot> {
  const artifacts = cache.filter((entry) => entry.compId === composition.id);
  const base = { compositionKey: composition.key, compositionId: composition.id, artifactCount: artifacts.length };
  if (!artifacts.length) return { ...base, status: "missing" };
  if (artifacts.every((entry) => !entry.inputs)) return { ...base, status: "untracked" };
  const snapshot = await loadInputs(composition.key);
  const hashes = new Map<string, string | null>(Object.entries(snapshot.inputs));
  for (const input of snapshot.missing) hashes.set(input, null);
  const currentArtifacts = artifacts
    .filter((entry) => artifactStatusFromInputs(entry.inputs, hashes) === "current")
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    ...base,
    status: currentArtifacts.length ? "current" : "stale",
    ...(currentArtifacts[0] ? { artifact: currentArtifacts[0] } : {}),
  };
}

export interface ProjectOperationsState {
  cache: CacheEntryDescriptor[];
  cacheLoading: boolean;
  busy: boolean;
  progress: RenderProgressSnapshot | null;
  currentBake: CurrentCompositionBakeSnapshot | null;
  message: string | null;
  error: string | null;
}

export class ProjectOperationsManager {
  public readonly state = new ObservableValue<ProjectOperationsState>({
    cache: [], cacheLoading: false, busy: false, progress: null, currentBake: null, message: null, error: null,
  });
  private sessionUnsubscribe: (() => void) | null = null;
  private editUnsubscribe: (() => void) | null = null;
  private inputUnsubscribe: (() => void) | null = null;
  private lastComposition: CompositionDescriptor | undefined;
  private bakeGeneration = 0;
  private cacheGeneration = 0;

  public constructor(private readonly session: StudioSession, private readonly workspace: ObservableProjectWorkspace) {}

  public start(): void {
    if (this.sessionUnsubscribe) return;
    this.sessionUnsubscribe = this.session.state.subscribe((state) => {
      const composition = state.compositions.find((entry) => entry.key === state.currentKey);
      if (composition === this.lastComposition) return;
      this.lastComposition = composition;
      void this.refreshCurrentBake();
    });
    this.editUnsubscribe = this.workspace.subscribeProjectEdits?.(() => { void this.refreshCurrentBake(); }) ?? null;
    this.inputUnsubscribe = this.workspace.subscribeBakeInputChanges?.(() => { void this.refreshCurrentBake(); }) ?? null;
  }

  public destroy(): void {
    this.sessionUnsubscribe?.();
    this.editUnsubscribe?.();
    this.inputUnsubscribe?.();
    this.sessionUnsubscribe = null;
    this.editUnsubscribe = null;
    this.inputUnsubscribe = null;
    this.bakeGeneration += 1;
    this.cacheGeneration += 1;
  }

  public async refreshCache(): Promise<void> {
    const generation = ++this.cacheGeneration;
    this.state.update((state) => ({ ...state, cacheLoading: true }));
    try {
      const cache = await this.workspace.listCacheEntries();
      if (generation !== this.cacheGeneration) return;
      this.state.update((state) => ({ ...state, cache, cacheLoading: false, error: null }));
      await this.refreshCurrentBake();
    } catch (error) {
      if (generation !== this.cacheGeneration) return;
      this.state.update((state) => ({
        ...state,
        cacheLoading: false,
        error: errorMessage(error, "Could not read the render cache."),
      }));
    }
  }

  public async refreshCurrentBake(): Promise<void> {
    const sessionState = this.session.state.get();
    const composition = sessionState.compositions.find((entry) => entry.key === sessionState.currentKey);
    const generation = ++this.bakeGeneration;
    if (!composition) {
      this.state.update((state) => ({ ...state, currentBake: null }));
      return;
    }
    const artifacts = this.state.get().cache.filter((entry) => entry.compId === composition.id).length;
    this.state.update((state) => ({
      ...state,
      currentBake: { compositionKey: composition.key, compositionId: composition.id, status: "checking", artifactCount: artifacts },
    }));
    try {
      const currentBake = await compositionBakeSnapshot(
        composition,
        this.state.get().cache,
        (compositionKey) => this.workspace.getCompositionBakeInputs(compositionKey),
      );
      if (generation !== this.bakeGeneration) return;
      this.state.update((state) => ({ ...state, currentBake }));
    } catch (error) {
      if (generation !== this.bakeGeneration) return;
      this.state.update((state) => ({
        ...state,
        currentBake: null,
        error: errorMessage(error, `Could not check ${composition.id}'s cached render.`),
      }));
    }
  }

  /** Resolves to the new composition's key, or null when creation failed (state carries why). */
  public async create(request: NewCompositionRequest): Promise<string | null> {
    if (this.state.get().busy) return null;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    try {
      const result = await this.workspace.createComposition(request, this.session.state.get().currentKey);
      this.state.update((state) => ({ ...state, busy: false, message: result.ok ? result.message : null, error: result.ok ? null : result.message }));
      return result.ok ? result.compositionKey ?? null : null;
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        busy: false,
        error: errorMessage(error, "Could not create the composition."),
      }));
      return null;
    }
  }

  public copy(compositionKey: string, options?: { library?: boolean }): Promise<boolean> {
    return this.run(() => this.workspace.copyComposition(compositionKey, options));
  }

  public setLibrary(compositionKey: string, library: boolean): Promise<boolean> {
    return this.run(() => this.workspace.setCompositionLibrary(compositionKey, library));
  }

  public delete(compositionKey: string): Promise<boolean> {
    return this.run(() => this.workspace.deleteComposition(compositionKey));
  }

  public nest(targetKey: string, sourceKey: string, from = 0): Promise<boolean> {
    const guard = canNestComposition(this.session.state.get(), sourceKey, targetKey);
    if (!guard.ok) {
      this.state.update((state) => ({ ...state, error: guard.why ?? "That composition cannot be nested here." }));
      return Promise.resolve(false);
    }
    return this.run(() => this.workspace.nestComposition(targetKey, sourceKey, from));
  }

  public async bakeCurrent(): Promise<boolean> {
    if (this.state.get().busy) return false;
    this.state.update((state) => ({ ...state, busy: true, progress: { phase: "prepare", completed: 0, total: 1 }, error: null, message: null }));
    try {
      const result = await this.workspace.bakeComposition(this.session.state.get().currentKey, (progress) => {
        this.state.update((state) => ({ ...state, progress }));
      });
      this.state.update((state) => ({ ...state, busy: false, progress: null, message: `Cached ${result.filename}`, error: null }));
      await this.refreshCache();
      return true;
    } catch (error) {
      this.state.update((state) => ({ ...state, busy: false, progress: null, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  private async run(operation: () => Promise<ProjectOperationResult>): Promise<boolean> {
    if (this.state.get().busy) return false;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    try {
      const result = await operation();
      this.state.update((state) => ({ ...state, busy: false, message: result.ok ? result.message : null, error: result.ok ? null : result.message }));
      return result.ok;
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        busy: false,
        error: errorMessage(error, "Could not complete the project operation."),
      }));
      return false;
    }
  }
}
