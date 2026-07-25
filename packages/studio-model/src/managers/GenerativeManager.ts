import { ObservableValue } from "../observable";
import type { GenerativeWorkspaceSnapshot, ProjectWorkspacePort, StudioSessionState } from "../types";
import type { StudioSession } from "../StudioSession";

export interface GenerativeManagerState {
  workspace: GenerativeWorkspaceSnapshot | null;
  loading: boolean;
  busy: boolean;
  submitting: boolean;
  error: string | null;
  message: string | null;
}

export class GenerativeManager {
  private static readonly NOTICE_KEY = "framediff:gen-notice";
  public readonly state = new ObservableValue<GenerativeManagerState>({
    workspace: null,
    loading: false,
    busy: false,
    submitting: false,
    error: null,
    message: null,
  });
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastKey = "";
  private lastCompositions: StudioSessionState["compositions"] | null = null;
  private generation = 0;
  private readonly autoPinning = new Set<string>();
  private readonly autoPinned = new Set<string>();

  public constructor(private readonly session: StudioSession, private readonly workspacePort: ProjectWorkspacePort) {}

  public start(): void {
    if (this.unsubscribe) return;
    // Normal source rewrites are applied in place through HMR. Retain this stash as a fallback
    // for edits that require an explicit refresh (for example, changing app-level wiring).
    try {
      const raw = sessionStorage.getItem(GenerativeManager.NOTICE_KEY);
      if (raw) {
        sessionStorage.removeItem(GenerativeManager.NOTICE_KEY);
        const pending = JSON.parse(raw) as { message: string; at: number };
        // a fallback reload follows the source write within ms — anything older is stale
        if (Date.now() - pending.at < 10_000) {
          this.state.update((state) => ({ ...state, message: pending.message }));
        }
      }
    } catch {
      // sessionStorage unavailable (SSR, privacy mode) — the notice is best-effort
    }
    this.unsubscribe = this.session.state.subscribe((state) => {
      const registryChanged = state.compositions !== this.lastCompositions;
      if (state.currentKey === this.lastKey && !registryChanged) return;
      this.lastKey = state.currentKey;
      this.lastCompositions = state.compositions;
      void this.refresh();
    });
    this.timer = setInterval(() => {
      if (this.state.get().workspace?.status === "running") void this.refresh();
    }, 3_000);
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async refresh(): Promise<void> {
    const key = this.session.state.get().currentKey;
    const generation = ++this.generation;
    this.state.update((state) => ({ ...state, loading: true }));
    try {
      const workspace = await this.workspacePort.getGenerativeWorkspace(key);
      if (generation !== this.generation) return;
      this.state.update((state) => ({
        ...state,
        workspace,
        loading: false,
        error: null,
        message: state.message?.startsWith("Submitted generation") && workspace?.jobs.length
          ? null
          : state.message,
      }));
      await this.autoPinCompletedTake(key, workspace);
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.update((state) => ({ ...state, workspace: null, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  public update(patch: Record<string, unknown>): Promise<boolean> {
    return this.runDraftOperation(() => this.workspacePort.updateGenerativeRecipe(this.session.state.get().currentKey, patch));
  }
  public async generate(): Promise<boolean> {
    if (this.draftLocked()) return this.refuseDraftOperation();
    this.state.update((state) => ({ ...state, submitting: true }));
    try {
      return await this.run(
        () => this.workspacePort.submitGeneration(this.session.state.get().currentKey),
        true,
      );
    } finally {
      this.state.update((state) => ({ ...state, submitting: false }));
    }
  }
  public pin(take: number): Promise<boolean> { return this.run(() => this.workspacePort.pinGenerationTake(this.session.state.get().currentKey, take)); }
  public startFrom(take: number): Promise<boolean> { return this.runDraftOperation(() => this.workspacePort.startGenerationFromTake(this.session.state.get().currentKey, take)); }
  public startFromJob(jobId: string): Promise<boolean> { return this.runDraftOperation(() => this.workspacePort.startGenerationFromJob(this.session.state.get().currentKey, jobId)); }
  public configure(provider: string, key: string): Promise<boolean> { return this.run(() => this.workspacePort.configureProvider(provider, key)); }

  private runDraftOperation(operation: () => Promise<{ ok: boolean; message: string }>): Promise<boolean> {
    if (!this.draftLocked()) return this.run(operation);
    return this.refuseDraftOperation();
  }

  private draftLocked(): boolean {
    const state = this.state.get();
    return state.submitting
      || !!state.workspace?.jobs.some((job) => job.status === "queued" || job.status === "running");
  }

  private refuseDraftOperation(): Promise<boolean> {
    this.state.update((state) => ({
      ...state,
      error: "This recipe is locked until the generating take finishes.",
      message: null,
    }));
    return Promise.resolve(false);
  }

  private async autoPinCompletedTake(
    compositionKey: string,
    workspace: GenerativeWorkspaceSnapshot | null,
  ): Promise<void> {
    if (!workspace || workspace.pinnedTake !== 0) return;
    const completed = [...workspace.jobs].reverse().find((job) =>
      job.autoPinIfEmpty &&
      job.status === "done" &&
      job.take != null &&
      workspace.takes.some((take) => take.take === job.take),
    );
    if (!completed?.take) return;
    const operationKey = `${workspace.recipeId}:${completed.id}`;
    if (this.autoPinning.has(operationKey) || this.autoPinned.has(operationKey)) return;

    this.autoPinning.add(operationKey);
    this.state.update((state) => ({ ...state, busy: true, error: null }));
    try {
      const result = await this.workspacePort.pinGenerationTake(compositionKey, completed.take);
      if (result.ok) {
        this.autoPinned.add(operationKey);
        this.state.update((state) => ({
          ...state,
          busy: false,
          error: null,
          message: `Pinned take ${completed.take} by default.`,
        }));
        await this.refresh();
      } else {
        this.state.update((state) => ({ ...state, busy: false, message: null, error: result.message }));
      }
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        busy: false,
        message: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      this.autoPinning.delete(operationKey);
    }
  }

  private async run(
    operation: () => Promise<{ ok: boolean; message: string }>,
    refreshOnFailure = false,
  ): Promise<boolean> {
    if (this.state.get().busy) return false;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    try {
      const result = await operation();
      if (result.ok) {
        try {
          sessionStorage.setItem(GenerativeManager.NOTICE_KEY, JSON.stringify({ message: result.message, at: Date.now() }));
        } catch {
          // best-effort: without the stash the notice just won't survive a fallback reload
        }
      }
      this.state.update((state) => ({ ...state, busy: false, error: result.ok ? null : result.message, message: result.ok ? result.message : null }));
      if (result.ok || refreshOnFailure) {
        await this.refresh();
        if (!result.ok) {
          this.state.update((state) => ({ ...state, error: result.message, message: null }));
        }
      }
      return result.ok;
    } catch (error) {
      // a throw must never strand busy=true — that silently deadens every button
      this.state.update((state) => ({ ...state, busy: false, message: null, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }
}
