import type { Readable } from "svelte/store";
import type { RenderManager, RenderState } from "@framediff/studio-model";
import { openRenderWindow, renderWindowToken, runInRenderWindow } from "../renderWindow";
import { observableStore } from "./store";

export class RenderViewModel {
  public readonly store: Readable<RenderState>;

  public constructor(private readonly manager: RenderManager) {
    this.store = observableStore(manager.state);
  }

  public render(): Promise<boolean> {
    // The render-window document owns the actual export. Keeping DOM/WebGPU capture in a
    // selected, visible document avoids Chrome background-tab throttling and freezing.
    if (typeof window === "undefined" || renderWindowToken(window.location.href)) {
      return this.manager.renderCurrent();
    }
    const compositionKey = this.manager.currentCompositionKey;
    if (!compositionKey || this.manager.state.get().status === "rendering") return Promise.resolve(false);
    const handle = openRenderWindow(compositionKey);
    // Popup blockers should not make rendering unusable; the engine's Web Lock/worker timer
    // mitigations still give the in-tab fallback its best chance of completing.
    if (!handle) return this.manager.renderCurrent();
    return this.manager.renderCurrent((_key, onProgress) => runInRenderWindow(handle, onProgress));
  }
}
