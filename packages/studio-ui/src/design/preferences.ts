/**
 * Studio feel preferences.
 *
 * Motion and sound are part of the interface, not decoration, so they get a real preference
 * surface: persisted, observable, and honest about the OS-level `prefers-reduced-motion`
 * setting. A user who has asked their system for less motion gets less motion here without
 * having to find a toggle.
 */

export type FeelPreferences = {
  /** Ambient shader, staggered entrances, spring physics. */
  motion: boolean;
  /** Procedural UI sound. */
  sound: boolean;
  /** 0–1. Scales every voice; the engine's own levels stay deliberately quiet. */
  volume: number;
};

const STORAGE_KEY = "framediff:feel";

const DEFAULTS: FeelPreferences = { motion: true, sound: true, volume: 0.7 };

type Listener = (preferences: FeelPreferences) => void;

function systemReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function read(): FeelPreferences {
  if (typeof window === "undefined") return { ...DEFAULTS };
  let stored: Partial<FeelPreferences> = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<FeelPreferences>;
  } catch {
    stored = {};
  }
  // The OS setting is a floor, not a default: it turns motion off until the user opts back in
  // here explicitly, which is what `stored.motion === true` records.
  const motion = typeof stored.motion === "boolean" ? stored.motion : !systemReducedMotion();
  return {
    motion,
    sound: typeof stored.sound === "boolean" ? stored.sound : DEFAULTS.sound,
    volume: typeof stored.volume === "number" ? Math.min(1, Math.max(0, stored.volume)) : DEFAULTS.volume,
  };
}

class FeelPreferenceStore {
  #value: FeelPreferences = read();
  readonly #listeners = new Set<Listener>();

  get(): FeelPreferences {
    return this.#value;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#value);
    return () => this.#listeners.delete(listener);
  }

  set(patch: Partial<FeelPreferences>): void {
    const next = { ...this.#value, ...patch };
    if (next.motion === this.#value.motion && next.sound === this.#value.sound && next.volume === this.#value.volume) return;
    this.#value = next;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A studio with no storage quota still gets working preferences for this session.
      }
    }
    for (const listener of this.#listeners) listener(next);
  }

  toggleSound(): void {
    this.set({ sound: !this.#value.sound });
  }

  toggleMotion(): void {
    this.set({ motion: !this.#value.motion });
  }
}

let store: FeelPreferenceStore | null = null;

export function feelPreferences(): FeelPreferenceStore {
  return (store ??= new FeelPreferenceStore());
}

export { systemReducedMotion };
