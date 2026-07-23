import {
  Easing,
  clipMotion2DFromDocument,
  combineCompositionSetups,
  createAudioFadeOutSetup,
  createCharacterRiseSetup,
  createClipMotionSetup,
  createWipeRevealSetup,
  defineComposition,
  defineTimelineDocument,
  interpolate,
  spring,
  type CompositionSetup,
} from "framediff";
import source from "./PackageEffectsLab.html?raw";
import document from "./PackageEffectsLab.comp.json";
import timeline from "./PackageEffectsLab.timeline.json";

type PackageEffectsDocument = typeof document;

const motionRows = new Map([["effects-card", clipMotion2DFromDocument(document.motion)]]);

const authoredEffectSetup: CompositionSetup = ({ root, document: initial, onDocument, onCleanup }) => {
  const apply = (next: PackageEffectsDocument) => {
    motionRows.set("effects-card", clipMotion2DFromDocument(next.motion));
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
  apply(initial as PackageEffectsDocument);
  const stopDocument = onDocument((next) => apply(next as PackageEffectsDocument));
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
    createAudioFadeOutSetup({
      selector: "[data-fd-id=effects-audio]",
      settings: (value) => {
        const audio = (value as PackageEffectsDocument).audio;
        return { from: audio.fadeFrom, to: audio.fadeTo, volume: audio.volume };
      },
    }),
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
