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
  bytes: number;
  error: string | null;
}

export class RenderManager {
  public readonly state = new ObservableValue<RenderState>({
    status: "idle",
    progress: null,
    filename: null,
    bytes: 0,
    error: null,
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
    if (!key || this.state.get().status === "rendering") return false;
    this.session.pause();
    this.state.set({ status: "rendering", progress: { phase: "prepare", completed: 0, total: 1 }, filename: null, bytes: 0, error: null });
    try {
      const render = executor ?? ((compositionKey, onProgress) => this.workspace.renderComposition(compositionKey, onProgress));
      const result = await render(key, (progress) => {
        this.state.update((state) => ({ ...state, progress }));
      });
      this.state.set({ status: "done", progress: null, filename: result.filename, bytes: result.bytes, error: null });
      return true;
    } catch (error) {
      this.state.set({ status: "error", progress: null, filename: null, bytes: 0, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}
