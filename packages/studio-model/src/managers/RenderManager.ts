import { ObservableValue } from "../observable";
import type { ProjectWorkspacePort, RenderProgressSnapshot, RenderResult } from "../types";
import type { StudioSession } from "../StudioSession";

export type RenderExecutor = (
  compositionKey: string,
  onProgress: (progress: RenderProgressSnapshot) => void,
) => Promise<RenderResult>;

export interface RenderState {
  status: "idle" | "rendering" | "done" | "error";
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
      const render = executor ?? ((compositionKey, onProgress) => this.workspace.renderComposition(compositionKey, onProgress));
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        this.state.update((state) => ({
          ...state,
          progress: { phase: "prepare", completed: 0, total: 1 },
          batch: { current: index + 1, total: keys.length, compositionKey: key },
        }));
        const result = await render(key, (progress) => {
          this.state.update((state) => ({ ...state, progress }));
        });
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
      return true;
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        status: "error",
        progress: null,
        filename: null,
        filenames: [...filenames],
        bytes,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }
}
