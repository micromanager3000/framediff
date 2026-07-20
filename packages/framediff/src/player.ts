import type { AssetResolver } from "./assets/resolver";
import type { CompositionConfig, CompositionRegistry } from "./composition";
import { mountComposition, type CompositionHandle } from "./runtime";

export interface PlayerOptions {
  registry?: CompositionRegistry;
  resolver?: AssetResolver;
  frame?: number;
  playing?: boolean;
  loop?: boolean;
  onFrame?: (frame: number) => void;
}

export interface PlayerHandle {
  readonly composition: CompositionConfig;
  readonly mounted: CompositionHandle;
  get frame(): number;
  get playing(): boolean;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  destroy(): void;
}

/** Mount a composition into ordinary DOM and optionally run its preview clock. */
export function createPlayer(host: HTMLElement, composition: CompositionConfig, options: PlayerOptions = {}): PlayerHandle {
  let frame = options.frame ?? 0;
  let playing = options.playing ?? false;
  let animation = 0;
  let last = performance.now();
  const mounted = mountComposition(host, composition, { ...options, frame, playing });

  const seek = (next: number) => {
    const duration = Math.max(1, composition.durationInFrames);
    frame = options.loop === false ? Math.max(0, Math.min(duration - 1, next)) : ((next % duration) + duration) % duration;
    mounted.update({ frame, playing });
    options.onFrame?.(frame);
  };
  const tick = (now: number) => {
    if (!playing) return;
    const elapsed = Math.max(0, now - last);
    last = now;
    seek(frame + elapsed / 1000 * composition.fps);
    if (options.loop === false && frame >= composition.durationInFrames - 1) {
      playing = false;
      mounted.update({ playing: false });
      return;
    }
    animation = requestAnimationFrame(tick);
  };
  const play = () => {
    if (playing) return;
    playing = true;
    last = performance.now();
    mounted.update({ playing: true });
    animation = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(animation);
    mounted.update({ playing: false });
  };
  if (playing) animation = requestAnimationFrame(tick);

  return {
    composition,
    mounted,
    get frame() { return frame; },
    get playing() { return playing; },
    play,
    pause,
    seek,
    destroy() {
      playing = false;
      cancelAnimationFrame(animation);
      mounted.destroy();
    },
  };
}
