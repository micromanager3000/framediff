import type { CompositionSetup } from "../composition";

export type V2 = [number, number];

export interface ClipMotionPathPoint {
  frame: number;
  position: V2;
}

export interface ClipMotion2D {
  anchor: V2;
  sourceSize: V2;
  startFrame: number;
  endFrame: number;
  startPosition: V2;
  endPosition: V2;
  startScale: number;
  endScale: number;
  interpolation?: "linear" | "smooth";
  path?: ClipMotionPathPoint[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const fastOut = (value: number) => { const t = clamp01(value); return 1 - (1 - t) * (1 - t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const localFrame = (element: HTMLElement): number => Number(element.dataset.fdLocalFrame ?? 0);

export function evaluateClipMotion2D(motion: ClipMotion2D, frame: number): { x: number; y: number; scale: number } {
  const span = motion.endFrame - motion.startFrame;
  const progress = span > 0 ? clamp01((frame - motion.startFrame) / span) : 1;
  const t = motion.interpolation === "smooth" ? smoothstep(progress) : progress;
  const scale = lerp(motion.startScale, motion.endScale, t);
  let x = lerp(motion.startPosition[0], motion.endPosition[0], t);
  let y = lerp(motion.startPosition[1], motion.endPosition[1], t);
  const path = motion.path;
  if (path?.length) {
    if (frame <= path[0].frame) [x, y] = path[0].position;
    else if (frame >= path[path.length - 1].frame) [x, y] = path[path.length - 1].position;
    else for (let index = 0; index < path.length - 1; index += 1) {
      if (frame > path[index + 1].frame) continue;
      const local = (frame - path[index].frame) / (path[index + 1].frame - path[index].frame);
      x = lerp(path[index].position[0], path[index + 1].position[0], local);
      y = lerp(path[index].position[1], path[index + 1].position[1], local);
      break;
    }
  }
  return { x, y, scale };
}

export interface ClipMotionSetupOptions {
  motions: ReadonlyMap<string, ClipMotion2D> | Record<string, ClipMotion2D>;
  selector?: string;
  keyAttribute?: string;
}

/** Apply data-driven source-space position/scale motion to ordinary DOM layers. */
export function createClipMotionSetup(options: ClipMotionSetupOptions): CompositionSetup {
  const lookup = (key: string) => options.motions instanceof Map
    ? options.motions.get(key)
    : (options.motions as Record<string, ClipMotion2D>)[key];
  const selector = options.selector ?? "[data-fd-motion-for]";
  const keyAttribute = options.keyAttribute ?? "data-fd-motion-for";
  return ({ root, onFrame, onCleanup }) => {
    const stop = onFrame(() => {
      for (const layer of root.querySelectorAll<HTMLElement>(selector)) {
        const motion = lookup(layer.getAttribute(keyAttribute) ?? "");
        const clip = layer.closest<HTMLElement>("[data-fd-clip]");
        if (!motion || !clip) continue;
        const pose = evaluateClipMotion2D(motion, localFrame(clip));
        layer.style.inset = "auto";
        layer.style.left = `${pose.x - motion.anchor[0] * pose.scale}px`;
        layer.style.top = `${pose.y - motion.anchor[1] * pose.scale}px`;
        layer.style.width = `${motion.sourceSize[0] * pose.scale}px`;
        layer.style.height = `${motion.sourceSize[1] * pose.scale}px`;
      }
    });
    onCleanup(stop);
  };
}

export interface WipeRevealSetupOptions {
  selector?: string;
  distancePercent?: number;
}

/** Drive left-to-right reveal windows from `data-fd-wipe`, `-from`, and `-to`. */
export function createWipeRevealSetup(options: WipeRevealSetupOptions = {}): CompositionSetup {
  return ({ root, onFrame, onCleanup }) => {
    const stop = onFrame(() => {
      for (const clip of root.querySelectorAll<HTMLElement>(options.selector ?? "[data-fd-wipe]")) {
        const frameOwner = clip.matches("[data-fd-clip]") ? clip : clip.closest<HTMLElement>("[data-fd-clip]");
        const frame = localFrame(frameOwner ?? clip);
        const from = Number(clip.dataset.fdWipeFrom ?? 0);
        const to = Number(clip.dataset.fdWipeTo ?? 1);
        const progress = (frame - from) / Math.max(1e-6, to - from);
        const amount = clip.dataset.fdWipe === "fast" ? fastOut(progress) : clip.dataset.fdWipe === "linear" ? clamp01(progress) : smoothstep(progress);
        const distance = options.distancePercent ?? 100;
        clip.style.clipPath = `inset(0 ${distance - distance * amount}% 0 0)`;
      }
    });
    onCleanup(stop);
  };
}

export interface CharacterRiseSetupOptions {
  selector?: string;
  characterSelector?: string;
  distance?: number;
  lead?: number;
  stagger?: number;
  window?: number;
}

/** Stagger child characters using clip-local frame and authored animation start/end attributes. */
export function createCharacterRiseSetup(options: CharacterRiseSetupOptions = {}): CompositionSetup {
  return ({ root, onFrame, onCleanup }) => {
    const stop = onFrame(() => {
      for (const text of root.querySelectorAll<HTMLElement>(options.selector ?? "[data-fd-rise-text]")) {
        const clip = text.closest<HTMLElement>("[data-fd-clip]");
        if (!clip) continue;
        const frame = localFrame(clip);
        const start = Number(text.dataset.fdAnimStart ?? 0);
        const end = Number(text.dataset.fdAnimEnd ?? 1);
        const progress = (frame - start) / Math.max(1e-6, end - start);
        const characters = Array.from(text.querySelectorAll<HTMLElement>(options.characterSelector ?? "[data-fd-char]"));
        const last = Math.max(1, characters.length - 1);
        characters.forEach((character, index) => {
          const amount = 1 - clamp01((progress - ((options.lead ?? 0.02) + (options.stagger ?? 0.23) * index / last)) / (options.window ?? 0.08));
          character.style.transform = `translateY(${amount * amount * (options.distance ?? 60)}px)`;
          character.style.opacity = String(Number(text.dataset.fdTextOpacity ?? 1) * (1 - amount));
        });
      }
    });
    onCleanup(stop);
  };
}

export interface AudioFadeOutSetupOptions {
  selector: string;
  from: number;
  to: number;
  volume?: number;
}

/** Drive a deterministic composition-frame fade on an authored audio element. */
export function createAudioFadeOutSetup(options: AudioFadeOutSetupOptions): CompositionSetup {
  return ({ root, onFrame, onCleanup }) => {
    const stop = onFrame(({ frame }) => {
      const audio = root.querySelector<HTMLAudioElement>(options.selector);
      if (!audio) return;
      const progress = clamp01((frame - options.from) / Math.max(1e-6, options.to - options.from));
      const volume = (options.volume ?? 1) * (1 - progress);
      audio.dataset.framediffVolume = String(volume);
      audio.volume = volume;
    });
    onCleanup(stop);
  };
}
