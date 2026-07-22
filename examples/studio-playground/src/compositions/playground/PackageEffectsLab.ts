import {
  Easing,
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
import timeline from "./PackageEffectsLab.timeline.json";

const frameMathSetup: CompositionSetup = ({ query, onFrame, onCleanup }) => {
  const stop = onFrame(({ frame, fps }) => {
    const orb = query<HTMLElement>("[data-fd-id=effects-spring-orb]");
    if (!orb) return;
    const scale = spring({ frame, fps, delay: 18, from: 0.55, to: 1, config: { damping: 9, stiffness: 86 } });
    const rotation = interpolate(frame, [0, 239], [-35, 95], { easing: Easing.easeInOut, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    orb.style.transform = `scale(${scale}) rotate(${rotation}deg)`;
  });
  onCleanup(stop);
};

export const packageEffectsLabComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  setup: combineCompositionSetups(
    createCharacterRiseSetup({ distance: 72, stagger: 0.3, window: 0.1 }),
    createWipeRevealSetup(),
    createClipMotionSetup({
      motions: {
        "effects-card": {
          anchor: [215, 125],
          sourceSize: [430, 250],
          startFrame: 58,
          endFrame: 188,
          startPosition: [1180, 760],
          endPosition: [1480, 670],
          startScale: 0.72,
          endScale: 1.08,
          interpolation: "smooth",
          path: [
            { frame: 58, position: [1130, 760] },
            { frame: 118, position: [1330, 545] },
            { frame: 188, position: [1540, 690] },
          ],
        },
      },
    }),
    createAudioFadeOutSetup({ selector: "[data-fd-id=effects-audio]", from: 170, to: 239, volume: 0.12 }),
    frameMathSetup,
  ),
  meta: {
    timelineFile: "src/compositions/playground/PackageEffectsLab.timeline.json",
    deps: ["src/compositions/playground/PackageEffectsLab.ts"],
  },
});
