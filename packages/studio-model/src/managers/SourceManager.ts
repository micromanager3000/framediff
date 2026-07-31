import { ObservableValue } from "../observable";
import { errorMessage } from "../errors";
import type { ProjectWorkspacePort } from "../types";
import type { StudioSession } from "../StudioSession";

export interface SourceState {
  file: string | null;
  text: string;
  loading: boolean;
  error: string | null;
}

export class SourceManager {
  public readonly state = new ObservableValue<SourceState>({ file: null, text: "", loading: false, error: null });
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private lastCompositions: unknown;

  public constructor(
    private readonly session: StudioSession,
    private readonly workspace: ProjectWorkspacePort,
  ) {}

  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.state.subscribe((sessionState) => {
      const composition = sessionState.compositions.find((entry) => entry.key === sessionState.currentKey);
      const registryChanged = this.lastCompositions !== sessionState.compositions;
      this.lastCompositions = sessionState.compositions;
      const file = composition?.file ?? null;
      if (file !== this.state.get().file || registryChanged) void this.open(file);
    });
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.generation += 1;
  }

  public refresh(): Promise<void> {
    return this.open(this.state.get().file);
  }

  private async open(file: string | null): Promise<void> {
    const generation = ++this.generation;
    if (!file) {
      this.state.set({ file: null, text: "", loading: false, error: null });
      return;
    }
    const current = this.state.get();
    this.state.set({
      ...current,
      file,
      text: current.file === file ? current.text : "",
      loading: true,
      error: null,
    });
    try {
      const text = await this.workspace.readSource(file);
      if (generation !== this.generation) return;
      this.state.set({
        file,
        text: text ?? "",
        loading: false,
        error: text == null ? `Could not read ${file}.` : null,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.update((state) => ({
        ...state,
        file,
        loading: false,
        error: errorMessage(error, `Could not read ${file}.`),
      }));
    }
  }
}
