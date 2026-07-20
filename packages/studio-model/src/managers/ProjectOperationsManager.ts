import { ObservableValue } from "../observable";
import { canNestComposition } from "../nesting";
import type {
  CacheEntryDescriptor,
  NewCompositionRequest,
  ProjectOperationResult,
  ProjectWorkspacePort,
  RenderProgressSnapshot,
} from "../types";
import type { StudioSession } from "../StudioSession";

export interface ProjectOperationsState {
  cache: CacheEntryDescriptor[];
  cacheLoading: boolean;
  busy: boolean;
  progress: RenderProgressSnapshot | null;
  message: string | null;
  error: string | null;
}

export class ProjectOperationsManager {
  public readonly state = new ObservableValue<ProjectOperationsState>({
    cache: [], cacheLoading: false, busy: false, progress: null, message: null, error: null,
  });

  public constructor(private readonly session: StudioSession, private readonly workspace: ProjectWorkspacePort) {}

  public async refreshCache(): Promise<void> {
    this.state.update((state) => ({ ...state, cacheLoading: true }));
    const cache = await this.workspace.listCacheEntries();
    this.state.update((state) => ({ ...state, cache, cacheLoading: false }));
  }

  /** Resolves to the new composition's key, or null when creation failed (state carries why). */
  public async create(request: NewCompositionRequest): Promise<string | null> {
    if (this.state.get().busy) return null;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    const result = await this.workspace.createComposition(request, this.session.state.get().currentKey);
    this.state.update((state) => ({ ...state, busy: false, message: result.ok ? result.message : null, error: result.ok ? null : result.message }));
    return result.ok ? result.compositionKey ?? null : null;
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
    const result = await operation();
    this.state.update((state) => ({ ...state, busy: false, message: result.ok ? result.message : null, error: result.ok ? null : result.message }));
    return result.ok;
  }
}
