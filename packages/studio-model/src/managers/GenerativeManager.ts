import { ObservableValue } from "../observable";
import type { GenerativeWorkspaceSnapshot, ProjectWorkspacePort, StudioSessionState } from "../types";
import type { StudioSession } from "../StudioSession";

export interface GenerativeManagerState {
  workspace: GenerativeWorkspaceSnapshot | null;
  /** An editable recipe becomes a draft only through an explicit user action. */
  draftOpen: boolean;
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
    draftOpen: false,
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
  private operationGeneration = 0;
  private readonly draftOpenByComposition = new Map<string, boolean>();

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
      if (registryChanged) {
        const liveKeys = new Set(state.compositions.map((composition) => composition.key));
        for (const key of this.draftOpenByComposition.keys()) {
          if (!liveKeys.has(key)) this.draftOpenByComposition.delete(key);
        }
      }
      const compositionChanged = state.currentKey !== this.lastKey;
      this.lastKey = state.currentKey;
      this.lastCompositions = state.compositions;
      if (compositionChanged) {
        // Never leave the previous composition's recipe/takes interactive while the
        // replacement workspace is loading.
        this.generation++;
        this.operationGeneration++;
        this.state.update((current) => ({
          ...current,
          workspace: null,
          draftOpen: false,
          error: null,
          message: null,
          loading: false,
          busy: false,
          submitting: false,
        }));
      }
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
      if (generation !== this.generation || key !== this.session.state.get().currentKey) return;
      const draftOpen = workspace
        ? this.draftOpenByComposition.get(key) ?? (!(workspace.jobs?.length ?? 0) && !(workspace.takes?.length ?? 0))
        : false;
      if (workspace) this.draftOpenByComposition.set(key, draftOpen);
      this.state.update((state) => ({
        ...state,
        workspace,
        draftOpen,
        loading: false,
        error: null,
        message: state.message?.startsWith("Submitted generation") && workspace?.jobs.length
          ? null
          : state.message,
      }));
    } catch (error) {
      if (generation !== this.generation || key !== this.session.state.get().currentKey) return;
      // Keep the last matching workspace visible. Polling must be able to retry after a
      // transient bridge/provider failure instead of clearing the only active history.
      this.state.update((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  public update(patch: Record<string, unknown>): Promise<boolean> {
    const compositionKey = this.session.state.get().currentKey;
    if (!this.state.get().draftOpen) {
      this.state.update((state) => ({
        ...state,
        error: "Choose Add Take before editing the generation recipe.",
        message: null,
      }));
      return Promise.resolve(false);
    }
    return this.runDraftOperation(() => this.workspacePort.updateGenerativeRecipe(compositionKey, patch), compositionKey);
  }
  public openDraft(): boolean {
    if (this.draftLocked()) {
      void this.refuseDraftOperation();
      return false;
    }
    this.setDraftOpen(this.session.state.get().currentKey, true);
    this.state.update((state) => ({ ...state, error: null }));
    return true;
  }
  public async generate(): Promise<boolean> {
    if (this.draftLocked()) return this.refuseDraftOperation();
    if (!this.state.get().draftOpen) {
      this.state.update((state) => ({
        ...state,
        error: "Choose Add Take before starting another generation.",
        message: null,
      }));
      return false;
    }
    const compositionKey = this.session.state.get().currentKey;
    const operationGeneration = this.operationGeneration;
    const previousAttempts = this.attemptKeys(this.state.get().workspace);
    this.setDraftOpen(compositionKey, false);
    this.state.update((state) => ({ ...state, submitting: true }));
    try {
      const submitted = await this.run(
        () => this.workspacePort.submitGeneration(compositionKey),
        true,
        compositionKey,
        operationGeneration,
      );
      const attemptCreated = [...this.attemptKeys(this.state.get().workspace)]
        .some((key) => !previousAttempts.has(key));
      if (!submitted && !attemptCreated && this.isCurrentOperation(compositionKey, operationGeneration)) {
        this.setDraftOpen(compositionKey, true);
      }
      return submitted;
    } finally {
      if (this.isCurrentOperation(compositionKey, operationGeneration)) {
        this.state.update((state) => ({ ...state, submitting: false }));
      }
    }
  }
  public pin(take: number): Promise<boolean> {
    const compositionKey = this.session.state.get().currentKey;
    return this.run(() => this.workspacePort.pinGenerationTake(compositionKey, take), false, compositionKey);
  }
  public async startFrom(take: number): Promise<boolean> {
    const compositionKey = this.session.state.get().currentKey;
    const started = await this.runDraftOperation(() => this.workspacePort.startGenerationFromTake(compositionKey, take), compositionKey);
    if (started && compositionKey === this.session.state.get().currentKey) this.setDraftOpen(compositionKey, true);
    return started;
  }
  public async startFromJob(jobId: string): Promise<boolean> {
    const compositionKey = this.session.state.get().currentKey;
    const started = await this.runDraftOperation(() => this.workspacePort.startGenerationFromJob(compositionKey, jobId), compositionKey);
    if (started && compositionKey === this.session.state.get().currentKey) this.setDraftOpen(compositionKey, true);
    return started;
  }
  public configure(provider: string, key: string): Promise<boolean> { return this.run(() => this.workspacePort.configureProvider(provider, key)); }

  private runDraftOperation(operation: () => Promise<{ ok: boolean; message: string }>, compositionKey: string): Promise<boolean> {
    const operationGeneration = this.operationGeneration;
    if (!this.draftLocked()) return this.run(operation, false, compositionKey, operationGeneration);
    return this.refuseDraftOperation();
  }

  private draftLocked(): boolean { return this.state.get().submitting || this.state.get().busy; }

  private setDraftOpen(compositionKey: string, draftOpen: boolean): void {
    this.draftOpenByComposition.set(compositionKey, draftOpen);
    if (compositionKey === this.session.state.get().currentKey) {
      this.state.update((state) => ({ ...state, draftOpen }));
    }
  }

  private attemptKeys(workspace: GenerativeWorkspaceSnapshot | null): Set<string> {
    return new Set([
      ...(workspace?.jobs?.map((job) => `job:${job.id}`) ?? []),
      ...(workspace?.takes?.map((take) => `take:${take.take}`) ?? []),
    ]);
  }

  private refuseDraftOperation(): Promise<boolean> {
    this.state.update((state) => ({
      ...state,
      error: "Another recipe operation is still in progress.",
      message: null,
    }));
    return Promise.resolve(false);
  }

  private async run(
    operation: () => Promise<{ ok: boolean; message: string }>,
    refreshOnFailure = false,
    compositionKey = this.session.state.get().currentKey,
    operationGeneration = this.operationGeneration,
  ): Promise<boolean> {
    if (this.state.get().busy) return false;
    this.state.update((state) => ({ ...state, busy: true, error: null, message: null }));
    try {
      const result = await operation();
      if (!this.isCurrentOperation(compositionKey, operationGeneration)) return result.ok;
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
        if (!this.isCurrentOperation(compositionKey, operationGeneration)) return result.ok;
        if (!result.ok) {
          this.state.update((state) => ({ ...state, error: result.message, message: null }));
        }
      }
      return result.ok;
    } catch (error) {
      if (!this.isCurrentOperation(compositionKey, operationGeneration)) return false;
      // a throw must never strand busy=true — that silently deadens every button
      this.state.update((state) => ({ ...state, busy: false, message: null, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  private isCurrentOperation(compositionKey: string, operationGeneration: number): boolean {
    return operationGeneration === this.operationGeneration
      && compositionKey === this.session.state.get().currentKey;
  }
}
