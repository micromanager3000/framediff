import { ObservableValue } from "../observable";
import type { ProjectWorkspacePort, RenderProgressSnapshot } from "../types";
import type { StudioSession } from "../StudioSession";

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

  public async renderCurrent(): Promise<boolean> {
    const key = this.session.state.get().currentKey;
    if (!key || this.state.get().status === "rendering") return false;
    this.session.pause();
    this.state.set({ status: "rendering", progress: { phase: "prepare", completed: 0, total: 1 }, filename: null, bytes: 0, error: null });
    try {
      const result = await this.workspace.renderComposition(key, (progress) => {
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
