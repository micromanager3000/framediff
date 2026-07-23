import { writable, type Writable } from "svelte/store";

export interface StudioChromeSnapshot {
  left: "compositions" | "media";
  leftOpen: boolean;
  right: "inspector" | "code" | "guide";
  rightOpen: boolean;
  newCompositionOpen: boolean;
  cacheOpen: boolean;
}

export class StudioChromeViewModel {
  public readonly store: Writable<StudioChromeSnapshot> = writable({ left: "compositions", leftOpen: false, right: "inspector", rightOpen: false, newCompositionOpen: false, cacheOpen: false });

  public showLeft(left: StudioChromeSnapshot["left"]): void {
    this.store.update((state) => ({ ...state, left, leftOpen: true, rightOpen: false }));
  }

  public showRight(right: StudioChromeSnapshot["right"]): void {
    this.store.update((state) => ({ ...state, leftOpen: false, right, rightOpen: true }));
  }

  /** Select a desktop panel without forcing the compact overlay open on first load. */
  public selectRight(right: StudioChromeSnapshot["right"]): void {
    this.store.update((state) => ({ ...state, right }));
  }

  public openLeft(): void { this.store.update((state) => ({ ...state, leftOpen: true, rightOpen: false })); }
  public closeLeft(): void { this.store.update((state) => ({ ...state, leftOpen: false })); }
  public openRight(): void { this.store.update((state) => ({ ...state, leftOpen: false, rightOpen: true })); }
  public closeRight(): void { this.store.update((state) => ({ ...state, rightOpen: false })); }
  public closePanels(): void { this.store.update((state) => ({ ...state, leftOpen: false, rightOpen: false })); }
  public setNewCompositionOpen(newCompositionOpen: boolean): void { this.store.update((state) => ({ ...state, newCompositionOpen })); }
  public setCacheOpen(cacheOpen: boolean): void { this.store.update((state) => ({ ...state, cacheOpen })); }
}
