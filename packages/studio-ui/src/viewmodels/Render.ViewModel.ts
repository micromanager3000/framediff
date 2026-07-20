import type { Readable } from "svelte/store";
import type { RenderManager, RenderState } from "@framediff/studio-model";
import { observableStore } from "./store";

export class RenderViewModel {
  public readonly store: Readable<RenderState>;

  public constructor(private readonly manager: RenderManager) {
    this.store = observableStore(manager.state);
  }

  public render(): Promise<boolean> {
    return this.manager.renderCurrent();
  }
}
