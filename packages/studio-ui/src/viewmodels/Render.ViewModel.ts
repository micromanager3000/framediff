import { derived, type Readable } from "svelte/store";
import {
  renderTargetCompositions,
  selectedRenderTarget,
  type RenderManager,
  type RenderState,
  type StudioSession,
} from "@framediff/studio-model";
import { openRenderWindow, renderWindowRequest, runInRenderWindow } from "../renderWindow";
import { observableStore, sessionStore } from "./store";

export interface RenderTargetView {
  key: string;
  name: string;
}

export interface RenderViewState extends RenderState {
  targets: RenderTargetView[];
  selectedTargetKey: string | null;
  selectedTargetName: string | null;
}

export class RenderViewModel {
  public readonly store: Readable<RenderViewState>;

  public constructor(
    private readonly manager: RenderManager,
    private readonly session: StudioSession,
  ) {
    this.store = derived(
      [observableStore(manager.state), sessionStore(session)],
      ([render, sessionState]) => {
        const targets = renderTargetCompositions(sessionState);
        const selected = selectedRenderTarget(sessionState, targets);
        return {
          ...render,
          targets: targets.map((target) => ({ key: target.key, name: target.id })),
          selectedTargetKey: selected?.key ?? null,
          selectedTargetName: selected?.id ?? null,
        };
      },
    );
  }

  public render(): Promise<boolean> {
    const state = this.session.state.get();
    const selected = selectedRenderTarget(state);
    return selected ? this.renderKeys([selected.key]) : Promise.resolve(false);
  }

  public renderCurrentComposition(): Promise<boolean> {
    const key = this.session.state.get().currentKey;
    return key ? this.renderKeys([key]) : Promise.resolve(false);
  }

  public renderAll(): Promise<boolean> {
    const keys = renderTargetCompositions(this.session.state.get()).map((target) => target.key);
    return this.renderKeys(keys);
  }

  public selectTarget(compositionKey: string): void {
    if (!renderTargetCompositions(this.session.state.get()).some((target) => target.key === compositionKey)) return;
    this.session.navigate(compositionKey);
  }

  private renderKeys(compositionKeys: string[]): Promise<boolean> {
    if (!compositionKeys.length || this.manager.state.get().status === "rendering") return Promise.resolve(false);
    // The render-window document owns the actual export. Keeping DOM/WebGPU capture in a
    // selected, visible document avoids Chrome background-tab throttling and freezing.
    if (typeof window === "undefined" || renderWindowRequest(window.name)) {
      return this.manager.renderMany(compositionKeys);
    }
    const handles = compositionKeys.map((compositionKey) => ({
      compositionKey,
      handle: openRenderWindow(compositionKey),
    }));
    // Popup blockers should not make rendering unusable; the engine's Web Lock/worker timer
    // mitigations still give the in-tab fallback its best chance of completing.
    if (handles.some(({ handle }) => !handle)) {
      for (const { handle } of handles) handle?.popup.close();
      return this.manager.renderMany(compositionKeys);
    }
    const byComposition = new Map(handles.map(({ compositionKey, handle }) => [compositionKey, handle!]));
    return this.manager.renderMany(
      compositionKeys,
      (compositionKey, onProgress) => runInRenderWindow(byComposition.get(compositionKey)!, onProgress),
    );
  }
}
