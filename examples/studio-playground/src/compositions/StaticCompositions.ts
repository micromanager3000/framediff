import { defineComposition, type StudioComposition } from "framediff";
import mainSource from "./HeroMain.html?raw";
import lowerThirdSource from "./LowerThird.html?raw";
import endCardSource from "./EndCard.html?raw";
import gradeLabSource from "./labs/GradeLab.html?raw";
import heroFootageSource from "./HeroFootage.html?raw";
import excerptSource from "./HeroExcerpt.html?raw";
import heroScriptSource from "./HeroScript.html?raw";
import directManipulationLabSource from "./labs/DirectManipulationLab.html?raw";
import richPropertiesLabSource from "./labs/RichPropertiesLab.html?raw";
import editorialLabSource from "./labs/EditorialLab.html?raw";
import productionLabSource from "./labs/ProductionLab.html?raw";
import { gsapMotionLabComp } from "./labs/GsapMotionLab";
import { productionLabGuide } from "./labs/ProductionLabGuide";
import { setupHeroGrade } from "../effects/heroLooks";
import { FPS } from "../data/constants";

export const lowerThirdComp = defineComposition(lowerThirdSource);
export const heroScriptComp = defineComposition(heroScriptSource);
export const endCardComp = defineComposition(endCardSource);
export const gradeLabComp = defineComposition(gradeLabSource, { setup: setupHeroGrade });
export const heroFootageComp = defineComposition(heroFootageSource);
export const heroExcerptComp = defineComposition(excerptSource);
export const directManipulationLabComp = defineComposition(directManipulationLabSource);
export const richPropertiesLabComp = defineComposition(richPropertiesLabSource);
export const editorialLabComp = defineComposition(editorialLabSource);
export const productionLabComp = defineComposition(productionLabSource, {
  meta: { deps: ["src/compositions/labs/ProductionLabGuide.ts"] },
}) as StudioComposition;
productionLabComp.meta = { ...productionLabComp.meta, guide: productionLabGuide };

const rebuiltClips = ["clip2", "clip3", "clip5", "clip4", "clip6"]
  .map((clip, index) => `<section data-fd-clip data-fd-id="${clip}" data-fd-name="${clip}" data-fd-from="${index * 144}" data-fd-duration="144" data-fd-src="asset://legacy-${clip}" data-fd-grade-temperature="0.14" data-fd-grade-contrast="-0.2" data-fd-grade-saturation="1.04" data-fd-grade-vignette="0.32"><canvas data-fd-grade-video></canvas></section>`)
  .join("");
export const heroRebuiltComp = defineComposition(
  `<!doctype html><html><head><style>[data-fd-composition],[data-fd-clip],canvas{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#000}</style></head><body><main data-fd-composition data-fd-id="HeroRebuilt" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="720" data-fd-kind="edit" data-fd-library="true">${rebuiltClips}</main></body></html>`,
  { setup: setupHeroGrade, meta: { file: "src/compositions/StaticCompositions.ts", sourceFormat: "generated", library: true } },
);

export const composition = defineComposition(mainSource, {
  meta: { deps: ["src/data/constants.ts", "src/compositions/HeroRaw.ts", "src/compositions/HeroPlane3D.ts"] },
});

export { gsapMotionLabComp };
