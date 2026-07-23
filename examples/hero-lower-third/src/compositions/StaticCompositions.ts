import { defineComposition, defineTimelineDocument } from "framediff";
import mainSource from "./HeroMain.html?raw";
import lowerThirdSource from "./LowerThird.html?raw";
import endCardSource from "./EndCard.html?raw";
import heroFootageSource from "./HeroFootage.html?raw";
import excerptSource from "./HeroExcerpt.html?raw";
import heroScriptSource from "./HeroScript.html?raw";
import heroFootageTimeline from "./HeroFootage.timeline.json";
import heroExcerptTimeline from "./HeroExcerpt.timeline.json";
import heroMainTimeline from "./HeroMain.timeline.json";
import heroRebuiltTimeline from "./HeroRebuilt.timeline.json";
import lowerThirdDocument from "./LowerThird.comp.json";
import endCardDocument from "./EndCard.comp.json";
import heroScriptDocument from "./HeroScript.comp.json";
import heroRebuiltDocument from "./HeroRebuilt.comp.json";
import { setupHeroGrade } from "../effects/heroLooks";
import { FPS } from "../data/constants";

export const lowerThirdComp = defineComposition(lowerThirdSource, {
  document: lowerThirdDocument,
  meta: { document: {
    file: "src/compositions/LowerThird.comp.json",
    schema: "src/compositions/LowerThird.schema.json",
    bindings: { "lower-third-content": "/content", "lower-third-copy": "/copy", "lower-third-brand": "/brand" },
  } },
});
export const heroScriptComp = defineComposition(heroScriptSource, {
  document: heroScriptDocument,
  meta: { document: {
    file: "src/compositions/HeroScript.comp.json",
    schema: "src/compositions/HeroScript.schema.json",
    bindings: { "hero-script-title": "/title" },
  } },
});
export const endCardComp = defineComposition(endCardSource, {
  document: endCardDocument,
  meta: { document: {
    file: "src/compositions/EndCard.comp.json",
    schema: "src/compositions/EndCard.schema.json",
    bindings: { cta: "/cta", "end-card-line": "/line", "end-card-url": "/url", "end-card-shine": "/shine" },
  } },
});
export const heroFootageComp = defineComposition(heroFootageSource, {
  timeline: defineTimelineDocument(heroFootageTimeline),
  meta: { timelineFile: "src/compositions/HeroFootage.timeline.json" },
});
export const heroExcerptComp = defineComposition(excerptSource, {
  timeline: defineTimelineDocument(heroExcerptTimeline),
  meta: { timelineFile: "src/compositions/HeroExcerpt.timeline.json" },
});

const rebuiltClips = ["clip2", "clip3", "clip5", "clip4", "clip6"]
  .map((clip) => `<section data-fd-clip data-fd-id="${clip}"><canvas data-fd-grade-video></canvas></section>`)
  .join("");
export const heroRebuiltComp = defineComposition(
  `<!doctype html><html><head><style>[data-fd-composition],[data-fd-clip],canvas{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#000}</style></head><body><main data-fd-composition data-fd-id="HeroRebuilt" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="720" data-fd-kind="edit" data-fd-library="true">${rebuiltClips}</main></body></html>`,
  {
    document: heroRebuiltDocument,
    timeline: defineTimelineDocument(heroRebuiltTimeline),
    setup: setupHeroGrade,
    meta: {
      file: "src/compositions/StaticCompositions.ts",
      sourceFormat: "generated",
      library: true,
      timelineFile: "src/compositions/HeroRebuilt.timeline.json",
      document: {
        file: "src/compositions/HeroRebuilt.comp.json",
        schema: "src/compositions/HeroRebuilt.schema.json",
        bindings: Object.fromEntries(["clip2", "clip3", "clip5", "clip4", "clip6"].map((clip) => [clip, `/${clip}`])),
        inspector: { title: "HERO REBUILT LOOKS" },
      },
    },
  },
);

export const composition = defineComposition(mainSource, {
  timeline: defineTimelineDocument(heroMainTimeline),
  meta: {
    timelineFile: "src/compositions/HeroMain.timeline.json",
    deps: ["src/data/constants.ts", "src/compositions/HeroRaw.ts", "src/compositions/HeroPlane3D.ts"],
  },
});
