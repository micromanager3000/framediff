import { ObservableValue } from "../observable";
import type { AssetDescriptor, ProjectWorkspacePort } from "../types";

export interface AssetState {
  assets: AssetDescriptor[];
  loading: boolean;
  uploading: boolean;
  error: string | null;
}

export class AssetManager {
  public readonly state = new ObservableValue<AssetState>({ assets: [], loading: false, uploading: false, error: null });

  public constructor(private readonly workspace: ProjectWorkspacePort) {}

  public async refresh(): Promise<void> {
    this.state.update((state) => ({ ...state, loading: true, error: null }));
    try {
      const assets = await this.workspace.listAssets();
      this.state.set({ ...this.state.get(), assets, loading: false });
    } catch (error) {
      this.state.update((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  public async upload(files: FileList | File[]): Promise<void> {
    this.state.update((state) => ({ ...state, uploading: true, error: null }));
    try {
      for (const file of Array.from(files)) {
        const id = await this.workspace.uploadAsset(file);
        if (!id) throw new Error(`Could not import ${file.name}.`);
      }
      await this.refresh();
      this.state.update((state) => ({ ...state, uploading: false }));
    } catch (error) {
      this.state.update((state) => ({ ...state, uploading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
