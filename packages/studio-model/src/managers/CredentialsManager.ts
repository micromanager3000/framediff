import { ObservableValue } from "../observable";
import type { ProjectWorkspacePort, ProviderCredentialsSnapshot } from "../types";

export interface CredentialsManagerState {
  credentials: ProviderCredentialsSnapshot | null;
  loading: boolean;
  busyProvider: string | null;
  error: string | null;
  message: string | null;
}

export class CredentialsManager {
  public readonly state = new ObservableValue<CredentialsManagerState>({
    credentials: null,
    loading: false,
    busyProvider: null,
    error: null,
    message: null,
  });

  public constructor(private readonly workspace: ProjectWorkspacePort) {}

  public start(): void {
    void this.refresh();
  }

  public destroy(): void {}

  public async refresh(): Promise<void> {
    this.state.update((state) => ({ ...state, loading: true }));
    try {
      const credentials = await this.workspace.getProviderCredentials();
      this.state.update((state) => ({ ...state, credentials, loading: false, error: null }));
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  public configure(provider: string, key: string): Promise<boolean> {
    return this.run(provider, () => this.workspace.configureProvider(provider, key));
  }

  public clear(provider: string): Promise<boolean> {
    return this.run(provider, () => this.workspace.clearProvider(provider));
  }

  private async run(
    provider: string,
    operation: () => Promise<{ ok: boolean; message: string }>,
  ): Promise<boolean> {
    if (this.state.get().busyProvider) return false;
    this.state.update((state) => ({ ...state, busyProvider: provider, error: null, message: null }));
    try {
      const result = await operation();
      await this.refresh();
      this.state.update((state) => ({
        ...state,
        busyProvider: null,
        error: result.ok ? null : result.message,
        message: result.ok ? result.message : null,
      }));
      return result.ok;
    } catch (error) {
      this.state.update((state) => ({
        ...state,
        busyProvider: null,
        message: null,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }
}
