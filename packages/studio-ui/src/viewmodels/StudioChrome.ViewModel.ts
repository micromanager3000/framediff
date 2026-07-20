import { writable, type Writable } from "svelte/store";

export interface StudioChromeSnapshot {
  left: "compositions" | "media";
  right: "inspector" | "code" | "guide";
  rightOpen: boolean;
  newCompositionOpen: boolean;
  cacheOpen: boolean;
}

export class StudioChromeViewModel {
  public readonly store: Writable<StudioChromeSnapshot> = writable({ left: "compositions", right: "inspector", rightOpen: false, newCompositionOpen: false, cacheOpen: false });

  public showLeft(left: StudioChromeSnapshot["left"]): void {
    this.store.update((state) => ({ ...state, left }));
  }

  public showRight(right: StudioChromeSnapshot["right"]): void {
    this.store.update((state) => ({ ...state, right, rightOpen: true }));
  }

  /** Select a desktop panel without forcing the compact overlay open on first load. */
  public selectRight(right: StudioChromeSnapshot["right"]): void {
    this.store.update((state) => ({ ...state, right }));
  }

  public openRight(): void { this.store.update((state) => ({ ...state, rightOpen: true })); }
  public closeRight(): void { this.store.update((state) => ({ ...state, rightOpen: false })); }
  public setNewCompositionOpen(newCompositionOpen: boolean): void { this.store.update((state) => ({ ...state, newCompositionOpen })); }
  public setCacheOpen(cacheOpen: boolean): void { this.store.update((state) => ({ ...state, cacheOpen })); }
}
