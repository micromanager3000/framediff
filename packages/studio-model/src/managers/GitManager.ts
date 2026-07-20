import { ObservableValue } from "../observable";
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

  public constructor(private readonly workspace: ProjectWorkspacePort) {}

  public start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 4_000);
  }

  public destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async refresh(): Promise<void> {
    this.state.update((state) => ({ ...state, loading: true }));
    const dirty = await this.workspace.getGitStatus();
    this.state.update((state) => ({ ...state, dirty, loading: false }));
  }

  public async commit(message: string): Promise<boolean> {
    if (!message.trim()) return false;
    this.state.update((state) => ({ ...state, committing: true, error: null }));
    const hash = await this.workspace.commit(message.trim());
    if (!hash) {
      this.state.update((state) => ({ ...state, committing: false, error: "Could not create the checkpoint." }));
      return false;
    }
    this.state.update((state) => ({ ...state, committing: false, lastCommit: hash }));
    await this.refresh();
    return true;
  }
}
