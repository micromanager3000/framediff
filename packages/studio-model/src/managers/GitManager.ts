import { ObservableValue } from "../observable";
import { errorMessage } from "../errors";
import type { ProjectWorkspacePort } from "../types";

export interface GitState {
  dirty: string[] | null;
  loading: boolean;
  committing: boolean;
  lastCommit: string | null;
  error: string | null;
}

export class GitManager {
  public readonly state = new ObservableValue<GitState>({ dirty: null, loading: false, committing: false, lastCommit: null, error: null });
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshGeneration = 0;

  public constructor(private readonly workspace: ProjectWorkspacePort) {}

  public start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 4_000);
  }

  public destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.refreshGeneration += 1;
  }

  public async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.state.update((state) => ({ ...state, loading: true }));
    try {
      const dirty = await this.workspace.getGitStatus();
      if (generation !== this.refreshGeneration) return;
      this.state.update((state) => ({ ...state, dirty, loading: false, error: null }));
    } catch (error) {
      if (generation !== this.refreshGeneration) return;
      this.state.update((state) => ({
        ...state,
        loading: false,
        error: errorMessage(error, "Could not read the project Git status."),
      }));
    }
  }

  public async commit(message: string): Promise<boolean> {
    if (!message.trim() || this.state.get().committing) return false;
    this.state.update((state) => ({ ...state, committing: true, error: null }));
    try {
      const hash = await this.workspace.commit(message.trim());
      if (!hash) {
        this.state.update((state) => ({ ...state, committing: false, error: "Could not create the checkpoint." }));
        return false;
      }
      this.state.update((state) => ({ ...state, committing: false, lastCommit: hash }));
      await this.refresh();
      return true;
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        committing: false,
        error: errorMessage(error, "Could not create the checkpoint."),
      }));
      return false;
    }
  }
}
