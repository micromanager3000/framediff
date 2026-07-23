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
  textAttribute?: string;
  distance?: number;
  lead?: number;
  stagger?: number;
  window?: number;
}

function syncCharacterRiseText(text: HTMLElement, characterSelector: string, textAttribute: string): void {
  const source = text.getAttribute(textAttribute);
  if (source == null) return;
  const characters = Array.from(text.querySelectorAll<HTMLElement>(characterSelector));
  if (characters.map((character) => character.textContent ?? "").join("") === source) return;
  text.replaceChildren(...[...source].map((character, index) => {
    const span = document.createElement("span");
    span.dataset.fdChar = String(index);
    span.textContent = character;
    return span;
  }));
}

/**
 * Stagger child characters using clip-local frame and authored animation start/end attributes.
 * A `data-fd-text` source is split again after document edits so JSON-backed copy keeps the effect.
 */
export function createCharacterRiseSetup(options: CharacterRiseSetupOptions = {}): CompositionSetup {
  return ({ root, onFrame, onDocument, onCleanup }) => {
    const selector = options.selector ?? "[data-fd-rise-text]";
    const characterSelector = options.characterSelector ?? "[data-fd-char]";
    const textAttribute = options.textAttribute ?? "data-fd-text";
    const sync = () => {
      for (const text of root.querySelectorAll<HTMLElement>(selector)) {
        syncCharacterRiseText(text, characterSelector, textAttribute);
      }
    };
    sync();
    const stopDocument = onDocument(sync);
    const stop = onFrame(() => {
      for (const text of root.querySelectorAll<HTMLElement>(selector)) {
        const clip = text.closest<HTMLElement>("[data-fd-clip]");
        if (!clip) continue;
        const setting = (attribute: string, fallback: number) => {
          const raw = text.getAttribute(attribute);
          if (raw == null) return fallback;
          const value = Number(raw);
          return Number.isFinite(value) ? value : fallback;
        };
        const frame = localFrame(clip);
        const start = Number(text.dataset.fdAnimStart ?? 0);
        const end = Number(text.dataset.fdAnimEnd ?? 1);
        const progress = (frame - start) / Math.max(1e-6, end - start);
        const characters = Array.from(text.querySelectorAll<HTMLElement>(characterSelector));
        const last = Math.max(1, characters.length - 1);
        const lead = setting("data-fd-rise-lead", options.lead ?? 0.02);
        const stagger = setting("data-fd-rise-stagger", options.stagger ?? 0.23);
        const window = setting("data-fd-rise-window", options.window ?? 0.08);
        const distance = setting("data-fd-rise-distance", options.distance ?? 60);
        characters.forEach((character, index) => {
          const amount = 1 - clamp01((progress - (lead + stagger * index / last)) / window);
          character.style.transform = `translateY(${amount * amount * distance}px)`;
          character.style.opacity = String(Number(text.dataset.fdTextOpacity ?? 1) * (1 - amount));
        });
      }
    });
    onCleanup(stop);
    onCleanup(stopDocument);
  };
}

export interface SplitScreenRevealMapping {
  fromPosition: number;
  toPosition: number;
  fromEdge: number;
  toEdge: number;
}

export interface SplitScreenRevealSetupOptions {
  motions: ReadonlyMap<string, ClipMotion2D> | Record<string, ClipMotion2D>;
  selector?: string;
  keyAttribute?: string;
  canvasWidth?: number;
  mapping?: SplitScreenRevealMapping;
}

export function evaluateSplitScreenRevealEdge(position: number, mapping: SplitScreenRevealMapping): number {
  const span = mapping.toPosition - mapping.fromPosition;
  const progress = span === 0 ? 1 : clamp01((position - mapping.fromPosition) / span);
  return lerp(mapping.fromEdge, mapping.toEdge, progress);
}

/**
 * Reveal the right pane of a moving split screen from the pane's package-authored 2D motion.
 * Element attributes may override the default position-to-edge mapping and canvas width.
 */
export function createSplitScreenRevealSetup(options: SplitScreenRevealSetupOptions): CompositionSetup {
  const lookup = (key: string) => options.motions instanceof Map
    ? options.motions.get(key)
    : (options.motions as Record<string, ClipMotion2D>)[key];
  const fallback = options.mapping ?? {
    fromPosition: 1,
    toPosition: 0,
    fromEdge: options.canvasWidth ?? 1920,
    toEdge: (options.canvasWidth ?? 1920) / 2,
  };
  const numericAttribute = (element: HTMLElement, name: string, value: number) => {
    const raw = element.getAttribute(name);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : value;
  };
  return ({ root, onFrame, onCleanup }) => {
    const stop = onFrame(() => {
      for (const pane of root.querySelectorAll<HTMLElement>(options.selector ?? "[data-fd-split-reveal]")) {
        const key = pane.getAttribute(options.keyAttribute ?? "data-fd-split-reveal") ?? "";
        const motion = lookup(key);
        const clip = pane.matches("[data-fd-clip]") ? pane : pane.closest<HTMLElement>("[data-fd-clip]");
        if (!motion || !clip) continue;
        const mapping = {
          fromPosition: numericAttribute(pane, "data-fd-split-from-position", fallback.fromPosition),
          toPosition: numericAttribute(pane, "data-fd-split-to-position", fallback.toPosition),
          fromEdge: numericAttribute(pane, "data-fd-split-from-edge", fallback.fromEdge),
          toEdge: numericAttribute(pane, "data-fd-split-to-edge", fallback.toEdge),
        };
        const width = numericAttribute(pane, "data-fd-split-canvas-width", options.canvasWidth ?? 1920);
        const position = evaluateClipMotion2D(motion, localFrame(clip)).x;
        const edge = Math.max(0, Math.min(width, evaluateSplitScreenRevealEdge(position, mapping)));
        pane.style.clipPath = `inset(0 0 0 ${(edge / width * 100).toFixed(2)}%)`;
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
