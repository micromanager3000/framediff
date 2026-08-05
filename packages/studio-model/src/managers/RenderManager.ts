import { ObservableValue } from "../observable";
import type { ProjectRenderSnapshot, ProjectWorkspacePort, RenderProgressSnapshot, RenderResult } from "../types";
import type { StudioSession } from "../StudioSession";

export interface RenderExecutor {
  (compositionKey: string, onProgress: (progress: RenderProgressSnapshot) => void): Promise<RenderResult>;
  /** Remote adapters may expose cancellation for the job id carried by progress events. */
  cancel?(jobId: string): Promise<void>;
}

export interface RenderState {
  status: "idle" | "rendering" | "done" | "error" | "cancelled";
  progress: RenderProgressSnapshot | null;
  filename: string | null;
  filenames: string[];
  bytes: number;
  error: string | null;
  batch: {
    current: number;
    total: number;
    compositionKey: string;
  } | null;
}

export interface RenderLibraryState {
  available: boolean;
  loading: boolean;
  entries: ProjectRenderSnapshot[];
  error: string | null;
  action: { id: string; kind: "download" | "retry" | "cancel" } | null;
}

export class RenderManager {
  public readonly state = new ObservableValue<RenderState>({
    status: "idle",
    progress: null,
    filename: null,
    filenames: [],
    bytes: 0,
    error: null,
    batch: null,
  });

  public readonly library: ObservableValue<RenderLibraryState>;

  public constructor(
    private readonly session: StudioSession,
    private readonly workspace: ProjectWorkspacePort,
  ) {
    this.library = new ObservableValue<RenderLibraryState>({
      available: typeof workspace.listProjectRenders === "function",
      loading: false,
      entries: [],
      error: null,
      action: null,
    });
  }

  private generation = 0;
  private libraryGeneration = 0;
  private libraryTimer: ReturnType<typeof setTimeout> | null = null;
  private libraryStarted = false;
  private activeExecutor: RenderExecutor | null = null;

  public start(): void {
    this.libraryStarted = true;
    void this.refreshLibrary();
  }

  public destroy(): void {
    this.libraryStarted = false;
    this.libraryGeneration += 1;
    if (this.libraryTimer) clearTimeout(this.libraryTimer);
    this.libraryTimer = null;
  }

  public async refreshLibrary(): Promise<boolean> {
    const list = this.workspace.listProjectRenders;
    if (!list) return false;
    const generation = ++this.libraryGeneration;
    this.library.update((state) => ({ ...state, available: true, loading: true, error: null }));
    try {
      const entries = await list.call(this.workspace, 40);
      if (generation !== this.libraryGeneration) return false;
      this.library.update((state) => ({ ...state, available: true, loading: false, entries, error: null }));
      this.scheduleLibraryRefresh(entries);
      return true;
    } catch (error) {
      if (generation !== this.libraryGeneration) return false;
      this.library.update((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      this.scheduleLibraryRefresh(this.library.get().entries);
      return false;
    }
  }

  public downloadLibraryEntry(renderId: string): Promise<boolean> {
    return this.runLibraryAction(renderId, "download", this.workspace.downloadProjectRender);
  }

  public retryLibraryEntry(renderId: string): Promise<boolean> {
    return this.runLibraryAction(renderId, "retry", this.workspace.retryProjectRender, true);
  }

  public cancelLibraryEntry(renderId: string): Promise<boolean> {
    return this.runLibraryAction(renderId, "cancel", this.workspace.cancelProjectRender, true);
  }

  private async runLibraryAction(
    renderId: string,
    kind: "download" | "retry" | "cancel",
    operation: ((renderId: string) => Promise<void>) | undefined,
    refresh = false,
  ): Promise<boolean> {
    if (!operation || this.library.get().action) return false;
    this.library.update((state) => ({ ...state, action: { id: renderId, kind }, error: null }));
    try {
      await operation.call(this.workspace, renderId);
      this.library.update((state) => ({ ...state, action: null }));
      if (refresh) void this.refreshLibrary();
      return true;
    } catch (error) {
      this.library.update((state) => ({
        ...state,
        action: null,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }

  private scheduleLibraryRefresh(entries: ProjectRenderSnapshot[]): void {
    if (this.libraryTimer) clearTimeout(this.libraryTimer);
    this.libraryTimer = null;
    if (!this.libraryStarted || !entries.some((entry) => ["queued", "starting", "rendering", "uploading"].includes(entry.state))) return;
    this.libraryTimer = setTimeout(() => void this.refreshLibrary(), 3_000);
  }

  /** The UI uses this to open the dedicated renderer before starting the state transition. */
  public get currentCompositionKey(): string | null {
    return this.session.state.get().currentKey || null;
  }

  /** Local browser capture needs a visible window; remote jobs remain in the Studio tab. */
  public get requiresDedicatedWindow(): boolean {
    return this.workspace.renderExecutionMode !== "remote";
  }

  public async renderCurrent(executor?: RenderExecutor): Promise<boolean> {
    const key = this.session.state.get().currentKey;
    return key ? this.renderMany([key], executor) : false;
  }

  public renderComposition(compositionKey: string, executor?: RenderExecutor): Promise<boolean> {
    return this.renderMany([compositionKey], executor);
  }

  public async renderMany(compositionKeys: string[], executor?: RenderExecutor): Promise<boolean> {
    const keys = [...new Set(compositionKeys.filter(Boolean))];
    if (!keys.length || this.state.get().status === "rendering") return false;
    const generation = ++this.generation;
    const renderExecutor = executor ?? ((compositionKey, onProgress) => this.workspace.renderComposition(compositionKey, onProgress));
    this.activeExecutor = renderExecutor;
    this.session.pause();
    const filenames: string[] = [];
    let bytes = 0;
    this.state.set({
      status: "rendering",
      progress: { phase: "prepare", completed: 0, total: 1 },
      filename: null,
      filenames,
      bytes,
      error: null,
      batch: { current: 1, total: keys.length, compositionKey: keys[0] },
    });
    try {
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        this.state.update((state) => ({
          ...state,
          progress: { phase: "prepare", completed: 0, total: 1 },
          batch: { current: index + 1, total: keys.length, compositionKey: key },
        }));
        const result = await renderExecutor(key, (progress) => {
          if (generation !== this.generation) return;
          this.state.update((state) => ({ ...state, progress }));
        });
        if (generation !== this.generation) return false;
        filenames.push(result.filename);
        bytes += result.bytes;
        this.state.update((state) => ({ ...state, filenames: [...filenames], bytes }));
      }
      this.state.set({
        status: "done",
        progress: null,
        filename: filenames.length === 1 ? filenames[0] : `${filenames.length} videos`,
        filenames: [...filenames],
        bytes,
        error: null,
        batch: keys.length > 1
          ? { current: keys.length, total: keys.length, compositionKey: keys[keys.length - 1] }
          : null,
      });
      this.activeExecutor = null;
      void this.refreshLibrary();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.state.update((state) => ({
        ...state,
        status: "error",
        progress: null,
        filename: null,
        filenames: [...filenames],
        bytes,
        error: error instanceof Error ? error.message : String(error),
      }));
      this.activeExecutor = null;
      void this.refreshLibrary();
      return false;
    }
  }

  /** Cancel a remote job when the injected executor exposes the provider-neutral hook. */
  public async cancel(): Promise<boolean> {
    const state = this.state.get();
    const jobId = state.status === "rendering" ? state.progress?.jobId : undefined;
    const executor = this.activeExecutor;
    if (!jobId || !executor?.cancel) return false;
    try {
      await executor.cancel(jobId);
      this.generation += 1;
      this.activeExecutor = null;
      this.state.update((current) => ({ ...current, status: "cancelled", progress: null, error: null }));
      void this.refreshLibrary();
      return true;
    } catch (error) {
      this.state.update((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }
}
