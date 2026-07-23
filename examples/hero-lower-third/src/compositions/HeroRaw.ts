import {
  combineCompositionSetups,
  defineComposition,
  defineTimelineDocument,
  kebabCase,
  type StudioComposition,
} from "framediff";
import { FPS, VIDEO_FRAMES } from "../data/constants";
import { HERO_SHOTS } from "../data/heroEdl";
import { heroGradeVideoSetup, preloadHeroLutsSetup } from "../effects/heroLooks";
import { heroMotionSetup } from "../effects/heroMotion";
import heroRawDocument from "./HeroRaw.comp.json";
import heroRawTimeline from "./HeroRaw.timeline.json";

const standardShots = HERO_SHOTS.filter((shot) => shot.fx !== "plane3d");
const shotHtml = standardShots.map((shot) =>
  `<section data-fd-clip data-fd-id="${kebabCase(shot.name)}" data-fd-name="${shot.name}" data-fd-motion-key="${shot.name}"><div class="motion" data-fd-motion-for="${shot.name}"><canvas data-fd-id="look-${shot.name}" data-fd-grade-video></canvas></div></section>`,
).join("\n");

export const heroBackdrop = heroRawDocument.backdrop.background;
const heroRawSource = `<!doctype html><html><head><style>
[data-fd-composition]{position:relative;overflow:hidden;background:#000;color:#fff;font-family:"SF Pro Display",-apple-system,sans-serif}
[data-fd-clip],.motion{position:absolute;inset:0}.motion canvas,canvas{position:absolute;inset:0;width:100%;height:100%}
</style></head><body><main data-fd-composition data-fd-id="HeroRaw" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="${VIDEO_FRAMES}" data-fd-kind="edit">
${shotHtml}
<div data-fd-clip data-fd-id="grid-reveal"></div>
<div data-fd-clip data-fd-id="split-screen"></div>
<div data-fd-clip data-fd-id="keynote-stack"></div>
<div data-fd-clip data-fd-id="logo-bumper"></div>
<div data-fd-clip data-fd-id="opening-copy"></div>
<div data-fd-clip data-fd-id="feature-copy"></div>
<div data-fd-clip data-fd-id="closing-copy"></div>
<div data-fd-clip data-fd-id="finishing" data-fd-name="Hero finishing grade" data-fd-grade-layer></div>
</main></body></html>`;

const bindings: Record<string, string> = {
  HeroRaw: "/backdrop",
  finishing: "/finishing",
  "music-bed": "/audio/bed",
  shine: "/audio/shine",
  "logo-reveal": "/audio/logoReveal",
  ...Object.fromEntries(standardShots.map((shot) => [kebabCase(shot.name), `/motion/${shot.name}`])),
  ...Object.fromEntries(standardShots.map((shot) => [`look-${shot.name}`, `/looks/${shot.name}`])),
};

export const heroRawComp = defineComposition(heroRawSource, {
  document: heroRawDocument,
  timeline: defineTimelineDocument(heroRawTimeline),
  setup: combineCompositionSetups(preloadHeroLutsSetup, heroMotionSetup, heroGradeVideoSetup),
  meta: {
    kind: "edit",
    file: "src/compositions/HeroRaw.ts",
    sourceFormat: "generated",
    timelineFile: "src/compositions/HeroRaw.timeline.json",
    document: {
      file: "src/compositions/HeroRaw.comp.json",
      schema: "src/compositions/HeroRaw.schema.json",
      bindings,
      hotUpdate: "remount",
      inspector: { title: "HERO RAW AUTHORING" },
    },
    deps: [
      "src/compositions/HeroRawFeatures.ts",
      "src/effects/heroGrade.ts",
      "src/effects/luts.ts",
      "src/data/constants.ts",
    ],
  },
}) as StudioComposition;
