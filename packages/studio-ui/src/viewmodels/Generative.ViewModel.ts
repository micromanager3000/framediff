import { derived, get, type Readable } from "svelte/store";
import type { AssetManager, GenerativeManager, GenerativeManagerState, AssetState } from "@framediff/studio-model";
import { observableStore } from "./store";

export interface GenerativeViewSnapshot extends GenerativeManagerState { assets: AssetState["assets"]; }

export class GenerativeViewModel {
  public readonly store: Readable<GenerativeViewSnapshot>;
  private readonly generationStore: Readable<GenerativeManagerState>;
  public constructor(private readonly manager: GenerativeManager, assets: AssetManager) {
    this.generationStore = observableStore(manager.state);
    this.store = derived([this.generationStore, observableStore(assets.state)], ([generation, assetState]) => ({ ...generation, assets: assetState.assets }));
  }
  public update(patch: Record<string, unknown>) { return this.manager.update(patch); }
  public generate() { return this.manager.generate(); }
  public pin(take: number) { return this.manager.pin(take); }
  public startFrom(take: number) { return this.manager.startFrom(take); }
  public configure(provider: string, key: string) { return this.manager.configure(provider, key); }
  public removeRef(index: number) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace) return Promise.resolve(false);
    return this.update({ refs: workspace.refs.filter((_, current) => current !== index).map(({ kind, src }) => ({ kind, src })) });
  }
  public addAssetRef(assetId: string, kind: string) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace) return Promise.resolve(false);
    return this.update({ refs: [...workspace.refs.map(({ kind: refKind, src }) => ({ kind: refKind, src })), { kind, src: `asset://${assetId}` }] });
  }
  public addCompositionRef(compositionKey: string, kind: string) {
    const workspace = get(this.generationStore).workspace;
    if (!workspace || compositionKey === workspace.compositionKey) return Promise.resolve(false);
    const src = `comp://${compositionKey}`;
    if (workspace.refs.some((ref) => ref.src === src)) return Promise.resolve(false);
    return this.update({ refs: [...workspace.refs.map(({ kind: refKind, src: refSrc }) => ({ kind: refKind, src: refSrc })), { kind, src }] });
  }
}
