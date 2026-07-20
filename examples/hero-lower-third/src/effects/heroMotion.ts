import {
  combineCompositionSetups,
  createAudioFadeOutSetup,
  createCharacterRiseSetup,
  createClipMotionSetup,
  createWipeRevealSetup,
  evaluateClipMotion2D,
  spring,
  type ClipMotion2D,
  type CompositionSetup,
} from "framediff";
import { FPS, VIDEO_FRAMES, TL } from "../data/constants";
import {
  HERO_GRID,
  HERO_KEYNOTE,
  HERO_SHOTS,
  HERO_SPLIT,
  type ShotMotion,
} from "../data/heroEdl";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const localFrame = (element: HTMLElement): number => Number(element.dataset.fdLocalFrame ?? 0);

function packagedMotion(motion: ShotMotion): ClipMotion2D {
  return {
    anchor: motion.anchor,
    sourceSize: [motion.srcW, motion.srcH],
    startFrame: motion.f0,
    endFrame: motion.f1,
    startPosition: motion.pos0,
    endPosition: motion.pos1,
    startScale: motion.scale0 / 100,
    endScale: motion.scale1 / 100,
    interpolation: motion.ease,
    path: motion.path?.map((point) => ({ frame: point.f, position: [point.x, point.y] })),
  };
}

const motionRows = new Map<string, ClipMotion2D>([
  ...HERO_SHOTS,
  ...HERO_GRID,
  ...HERO_SPLIT,
  ...HERO_KEYNOTE,
].flatMap((item) => item.motion ? [[item.name, packagedMotion(item.motion)] as const] : []));

const clipMotionSetup = createClipMotionSetup({ motions: motionRows });
const wipeSetup = createWipeRevealSetup();
const characterRiseSetup = createCharacterRiseSetup();
const audioFadeSetup = createAudioFadeOutSetup({
  selector: "audio[data-fd-audio-bed]",
  from: TL.audioFadeStart,
  to: VIDEO_FRAMES,
});

/** LightTwist-only split geometry and logo-bumper art direction. */
const heroSpecificMotionSetup: CompositionSetup = ({ root, onFrame, onCleanup }) => {
  const stop = onFrame(() => {
    for (const clip of root.querySelectorAll<HTMLElement>("[data-fd-split-right]")) {
      const motion = motionRows.get(clip.dataset.fdSplitRight ?? "");
      if (!motion) continue;
      const x = evaluateClipMotion2D(motion, localFrame(clip)).x;
      const edge = Math.max(960, Math.min(1920, 960 + (x - 1764) * (960 / 380)));
      clip.style.clipPath = `inset(0 0 0 ${(edge / 19.2).toFixed(2)}%)`;
    }

    const bumper = root.querySelector<HTMLElement>("[data-fd-bumper]");
    if (!bumper) return;
    const frame = localFrame(bumper);
    const duration = Number(bumper.getAttribute("data-fd-duration") ?? 1);
    const settle = spring({ frame, fps: FPS, config: { damping: 14, mass: 0.7 } });
    const exit = Math.pow(clamp((frame - (duration - 10)) / 10), 2);
    const wordmark = clamp((frame - 8) / 14);
    const particles = 1 - clamp((frame - 12) / 10);
    const wordmarkNode = bumper.querySelector<HTMLElement>(".wordmark");
    if (wordmarkNode) {
      wordmarkNode.style.opacity = String((1 - exit) * wordmark);
      wordmarkNode.style.filter = `blur(${(1 - wordmark) * 6}px) brightness(${1 + 0.15 * wordmark}) drop-shadow(0 10px 40px rgba(108,92,231,${0.4 * wordmark}))`;
    }
    bumper.querySelectorAll<HTMLElement>(".particle").forEach((particle, index) => {
      const hash = (index * 2654435761) % 997;
      const x = 260 + (hash % 1300) + (50 + hash % 90) * clamp(frame / 20) * ((index % 2) * 2 - 1);
      const y = 360 + ((hash >> 3) % 360) - (50 + hash % 90) * 0.6 * clamp(frame / 20);
      const size = 26 + hash % 46;
      const hue = 230 + hash % 65;
      particle.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:3px;background:hsl(${hue} 85% 66% / .85);opacity:${particles * (0.5 + 0.5 * Math.abs(Math.sin(index * 2.1 + frame * 0.22)))};box-shadow:0 0 ${size * 1.8}px hsl(${hue} 90% 62% / .9)`;
    });
    const flare = bumper.querySelector<HTMLVideoElement>("video");
    if (flare) flare.style.opacity = String(0.3 * settle * wordmark * (1 - exit));
  });
  onCleanup(stop);
};

export const heroMotionSetup = combineCompositionSetups(
  clipMotionSetup,
  wipeSetup,
  characterRiseSetup,
  heroSpecificMotionSetup,
  audioFadeSetup,
);
