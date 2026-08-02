import { writable, type Writable } from "svelte/store";

export interface StudioChromeSnapshot {
  left: "compositions" | "media";
  leftOpen: boolean;
  right: "inspector" | "code";
  rightOpen: boolean;
  /** The project walkthrough is a top-level surface, not a side panel — it spans the whole app. */
  guideExpanded: boolean;
  newCompositionOpen: boolean;
  cacheOpen: boolean;
  servicesOpen: boolean;
}

export class StudioChromeViewModel {
  public readonly store: Writable<StudioChromeSnapshot> = writable({ left: "compositions", leftOpen: false, right: "inspector", rightOpen: false, guideExpanded: false, newCompositionOpen: false, cacheOpen: false, servicesOpen: false });

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

  public setGuideExpanded(guideExpanded: boolean): void { this.store.update((state) => ({ ...state, guideExpanded })); }
  public toggleGuide(): void { this.store.update((state) => ({ ...state, guideExpanded: !state.guideExpanded })); }
  public openLeft(): void { this.store.update((state) => ({ ...state, leftOpen: true, rightOpen: false })); }
  public closeLeft(): void { this.store.update((state) => ({ ...state, leftOpen: false })); }
  public openRight(): void { this.store.update((state) => ({ ...state, leftOpen: false, rightOpen: true })); }
  public closeRight(): void { this.store.update((state) => ({ ...state, rightOpen: false })); }
  public closePanels(): void { this.store.update((state) => ({ ...state, leftOpen: false, rightOpen: false })); }
  public setNewCompositionOpen(newCompositionOpen: boolean): void { this.store.update((state) => ({ ...state, newCompositionOpen })); }
  public setCacheOpen(cacheOpen: boolean): void {
    this.store.update((state) => ({ ...state, cacheOpen, servicesOpen: cacheOpen ? false : state.servicesOpen }));
  }

  public setServicesOpen(servicesOpen: boolean): void {
    this.store.update((state) => ({ ...state, servicesOpen, cacheOpen: servicesOpen ? false : state.cacheOpen }));
  }
}
