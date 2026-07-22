import { createAudioFadeOutSetup, defineComposition, defineTimelineDocument, type StudioComposition } from "framediff";
import audioSource from "./AudioLab.html?raw";
import authoringSource from "./AuthoringChapter.html?raw";
import coverageSource from "./CoverageMap.html?raw";
import editorialSource from "./EditorialChapter.html?raw";
import effectsSource from "./EffectsChapter.html?raw";
import pipelineSource from "./PipelineChapter.html?raw";
import playgroundSource from "./StudioPlayground.html?raw";
import authoringTimeline from "./AuthoringChapter.timeline.json";
import editorialTimeline from "./EditorialChapter.timeline.json";
import effectsTimeline from "./EffectsChapter.timeline.json";
import pipelineTimeline from "./PipelineChapter.timeline.json";
import playgroundTimeline from "./StudioPlayground.timeline.json";
import coverageDocument from "./CoverageMap.comp.json";
import { audioLabComp } from "./AudioLab";
import { clothLabComp } from "./ClothLab";
import { packageEffectsLabComp } from "./PackageEffectsLab";
import { studioPlaygroundGuide } from "./StudioPlaygroundGuide";
import { worldLabComp } from "./WorldLab";

export const coverageMapComp = defineComposition(coverageSource, {
  document: coverageDocument,
  meta: { document: {
    file: "src/compositions/playground/CoverageMap.comp.json",
    schema: "src/compositions/playground/CoverageMap.schema.json",
    bindings: { "coverage-kicker": "/kicker", "coverage-title-a": "/titleA", "coverage-title-b": "/titleB", "coverage-summary": "/summary" },
  } },
});
export const authoringChapterComp = defineComposition(authoringSource, {
  timeline: defineTimelineDocument(authoringTimeline),
  meta: { timelineFile: "src/compositions/playground/AuthoringChapter.timeline.json" },
});
export const editorialChapterComp = defineComposition(editorialSource, {
  timeline: defineTimelineDocument(editorialTimeline),
  meta: { timelineFile: "src/compositions/playground/EditorialChapter.timeline.json" },
});
export const effectsChapterComp = defineComposition(effectsSource, {
  timeline: defineTimelineDocument(effectsTimeline),
  meta: { timelineFile: "src/compositions/playground/EffectsChapter.timeline.json" },
});
export const pipelineChapterComp = defineComposition(pipelineSource, {
  timeline: defineTimelineDocument(pipelineTimeline),
  meta: { timelineFile: "src/compositions/playground/PipelineChapter.timeline.json" },
});

export const studioPlaygroundComp = defineComposition(playgroundSource, {
  timeline: defineTimelineDocument(playgroundTimeline),
  setup: createAudioFadeOutSetup({ selector: "[data-fd-id=playground-audio]", from: 1980, to: 2069, volume: 0.035 }),
  meta: {
    timelineFile: "src/compositions/playground/StudioPlayground.timeline.json",
    deps: ["src/compositions/playground/StudioPlaygroundGuide.ts"],
  },
}) as StudioComposition;

studioPlaygroundComp.meta = { ...studioPlaygroundComp.meta, guide: studioPlaygroundGuide };

export { audioLabComp, clothLabComp, packageEffectsLabComp, worldLabComp };
