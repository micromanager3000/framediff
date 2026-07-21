import { createAudioFadeOutSetup, defineComposition, type StudioComposition } from "framediff";
import audioSource from "./AudioLab.html?raw";
import authoringSource from "./AuthoringChapter.html?raw";
import coverageSource from "./CoverageMap.html?raw";
import editorialSource from "./EditorialChapter.html?raw";
import effectsSource from "./EffectsChapter.html?raw";
import pipelineSource from "./PipelineChapter.html?raw";
import playgroundSource from "./StudioPlayground.html?raw";
import { audioLabComp } from "./AudioLab";
import { clothLabComp } from "./ClothLab";
import { packageEffectsLabComp } from "./PackageEffectsLab";
import { studioPlaygroundGuide } from "./StudioPlaygroundGuide";
import { worldLabComp } from "./WorldLab";

export const coverageMapComp = defineComposition(coverageSource);
export const authoringChapterComp = defineComposition(authoringSource);
export const editorialChapterComp = defineComposition(editorialSource);
export const effectsChapterComp = defineComposition(effectsSource);
export const pipelineChapterComp = defineComposition(pipelineSource);

export const studioPlaygroundComp = defineComposition(playgroundSource, {
  setup: createAudioFadeOutSetup({ selector: "[data-fd-id=playground-audio]", from: 1980, to: 2069, volume: 0.035 }),
  meta: { deps: ["src/compositions/playground/StudioPlaygroundGuide.ts"] },
}) as StudioComposition;

studioPlaygroundComp.meta = { ...studioPlaygroundComp.meta, guide: studioPlaygroundGuide };

export { audioLabComp, clothLabComp, packageEffectsLabComp, worldLabComp };
