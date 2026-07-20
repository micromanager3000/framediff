import { derived, writable, type Readable } from "svelte/store";
import type { AssetDescriptor, AssetManager, AssetState } from "@framediff/studio-model";
import { observableStore } from "./store";

export interface MediaViewSnapshot extends AssetState {
  selected?: AssetDescriptor;
}

export type MediaKindFilter = "all" | "video" | "audio" | "image" | "other";

export function assetMatchesFilter(asset: AssetDescriptor, query: string, kind: MediaKindFilter): boolean {
  const family = asset.mime.split("/", 1)[0];
  const matchesKind = kind === "all" || (kind === "other" ? !["video", "audio", "image"].includes(family) : family === kind);
  if (!matchesKind) return false;
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [asset.name, asset.id, asset.mime, asset.filename ?? "", asset.contentHash]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

export class MediaViewModel {
  public readonly store: Readable<MediaViewSnapshot>;
  private readonly selectedAssetId = writable<string | null>(null);

  public constructor(private readonly manager: AssetManager) {
    this.store = derived(
      [observableStore(manager.state), this.selectedAssetId],
      ([state, selectedAssetId]) => ({
        ...state,
        selected: state.assets.find((asset) => asset.id === selectedAssetId),
      }),
    );
  }

  public upload(files: FileList | File[]): Promise<void> {
    return this.manager.upload(files);
  }

  public refresh(): Promise<void> {
    return this.manager.refresh();
  }

  public select(assetId: string): void {
    this.selectedAssetId.set(assetId);
  }

  public clearSelection(): void {
    this.selectedAssetId.set(null);
  }
}
