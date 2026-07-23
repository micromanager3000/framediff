import {
  Easing,
  combineCompositionSetups,
  createCharacterRiseSetup,
  createClipMotionSetup,
  createWipeRevealSetup,
  defineComposition,
  defineTimelineDocument,
  interpolate,
  spring,
  type ClipMotion2D,
  type CompositionSetup,
} from "framediff";
import source from "./PackageEffectsLab.html?raw";
import document from "./PackageEffectsLab.comp.json";
import timeline from "./PackageEffectsLab.timeline.json";

type PackageEffectsDocument = typeof document;

function parsePath(value: string): ClipMotion2D["path"] {
  return value.split("|").flatMap((entry) => {
    const [frame, x, y] = entry.split(":").map(Number);
    return [frame, x, y].every(Number.isFinite) ? [{ frame, position: [x, y] as [number, number] }] : [];
  });
}

function motionFrom(value: PackageEffectsDocument["motion"]): ClipMotion2D {
  return {
    anchor: [value.anchorX, value.anchorY],
    sourceSize: [value.sourceWidth, value.sourceHeight],
    startFrame: value.startFrame,
    endFrame: value.endFrame,
    startPosition: [value.startX, value.startY],
    endPosition: [value.endX, value.endY],
    startScale: value.startScale,
    endScale: value.endScale,
    interpolation: value.interpolation as ClipMotion2D["interpolation"],
    path: parsePath(value.path),
  };
}

const motionRows = new Map<string, ClipMotion2D>([["effects-card", motionFrom(document.motion)]]);

const authoredEffectSetup: CompositionSetup = ({ root, document: initial, onFrame, onDocument, onCleanup }) => {
  let settings = initial as PackageEffectsDocument;
  const apply = (next: PackageEffectsDocument) => {
    settings = next;
    motionRows.set("effects-card", motionFrom(next.motion));
    const headline = root.querySelector<HTMLElement>("[data-fd-id=effects-headline]");
    if (headline) {
      headline.dataset.fdAnimStart = String(next.headline.animStartFrame);
      headline.dataset.fdAnimEnd = String(next.headline.animEndFrame);
      headline.setAttribute("data-fd-rise-distance", String(next.headline.distance));
      headline.setAttribute("data-fd-rise-stagger", String(next.headline.stagger));
      headline.setAttribute("data-fd-rise-window", String(next.headline.window));
    }
    const wipe = root.querySelector<HTMLElement>("[data-fd-id=effects-wipe]");
    if (wipe) {
      wipe.dataset.fdWipe = next.wipe.wipe;
      wipe.dataset.fdWipeFrom = String(next.wipe.wipeFrom);
      wipe.dataset.fdWipeTo = String(next.wipe.wipeTo);
    }
    const copy = {
      "effects-wipe-label": next.wipe.label,
      "effects-wipe-title": next.wipe.title,
      "effects-wipe-copy": next.wipe.copy,
    };
    for (const [id, text] of Object.entries(copy)) {
      const element = root.querySelector<HTMLElement>(`[data-fd-id="${id}"]`);
      if (element) element.textContent = text;
    }
  };
  apply(settings);
  const stopDocument = onDocument((next) => apply(next as PackageEffectsDocument));
  const stopFrame = onFrame(({ frame }) => {
    const audio = root.querySelector<HTMLAudioElement>("[data-fd-id=effects-audio]");
    if (!audio) return;
    const span = Math.max(1e-6, settings.audio.fadeTo - settings.audio.fadeFrom);
    const progress = Math.max(0, Math.min(1, (frame - settings.audio.fadeFrom) / span));
    const volume = settings.audio.volume * (1 - progress);
    audio.dataset.framediffVolume = String(volume);
    audio.volume = volume;
  });
  onCleanup(stopFrame);
  onCleanup(stopDocument);
};

const frameMathSetup: CompositionSetup = ({ query, document: initial, onFrame, onDocument, onCleanup }) => {
  let settings = (initial as PackageEffectsDocument).spring;
  const stopDocument = onDocument((next) => { settings = (next as PackageEffectsDocument).spring; });
  const stop = onFrame(({ frame, fps }) => {
    const orb = query<HTMLElement>("[data-fd-id=effects-spring-orb]");
    if (!orb) return;
    const scale = spring({
      frame,
      fps,
      delay: settings.delay,
      from: settings.from,
      to: settings.to,
      config: { damping: settings.damping, stiffness: settings.stiffness },
    });
    const rotation = interpolate(frame, [0, 239], [settings.rotationFrom, settings.rotationTo], {
      easing: Easing.easeInOut,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    orb.style.transform = `scale(${scale}) rotate(${rotation}deg)`;
  });
  onCleanup(stop);
  onCleanup(stopDocument);
};

export const packageEffectsLabComp = defineComposition(source, {
  document,
  timeline: defineTimelineDocument(timeline),
  setup: combineCompositionSetups(
    authoredEffectSetup,
    createCharacterRiseSetup(),
    createWipeRevealSetup(),
    createClipMotionSetup({ motions: motionRows }),
    frameMathSetup,
  ),
  meta: {
    timelineFile: "src/compositions/playground/PackageEffectsLab.timeline.json",
    deps: ["src/compositions/playground/PackageEffectsLab.ts"],
    document: {
      file: "src/compositions/playground/PackageEffectsLab.comp.json",
      schema: "src/compositions/playground/PackageEffectsLab.schema.json",
      bindings: {
        "effects-kicker": "/kicker",
        "effects-headline": "/headline",
        "effects-wipe-label": "/wipe",
        "effects-wipe-title": "/wipe",
        "effects-wipe-copy": "/wipe",
        "effects-motion-card": "/motion",
        "effects-spring-orb": "/spring",
        "effects-audio": "/audio"
      },
      inspector: { title: "PACKAGE EFFECTS" },
    },
  },
});
