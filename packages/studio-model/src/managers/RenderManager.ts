import { ObservableValue } from "../observable";
import type { ProjectWorkspacePort, RenderProgressSnapshot, RenderResult } from "../types";
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

  public constructor(
    private readonly session: StudioSession,
    private readonly workspace: ProjectWorkspacePort,
  ) {}

  private generation = 0;
  private activeExecutor: RenderExecutor | null = null;

  /** The UI uses this to open the dedicated renderer before starting the state transition. */
  public get currentCompositionKey(): string | null {
    return this.session.state.get().currentKey || null;
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
      return true;
    } catch (error) {
      this.state.update((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }
}
