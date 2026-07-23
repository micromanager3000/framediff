import { defineComposition, defineTimelineDocument, type CompositionSetup, type StudioComposition } from "framediff";
import mainSource from "./HeroMain.html?raw";
import lowerThirdSource from "./LowerThird.html?raw";
import endCardSource from "./EndCard.html?raw";
import gradeLabSource from "./labs/GradeLab.html?raw";
import gradeLabDocument from "./labs/GradeLab.comp.json";
import heroFootageSource from "./HeroFootage.html?raw";
import excerptSource from "./HeroExcerpt.html?raw";
import heroScriptSource from "./HeroScript.html?raw";
import directManipulationLabSource from "./labs/DirectManipulationLab.html?raw";
import directManipulationLabDocument from "./labs/DirectManipulationLab.comp.json";
import richPropertiesLabSource from "./labs/RichPropertiesLab.html?raw";
import richPropertiesLabDocument from "./labs/RichPropertiesLab.comp.json";
import editorialLabSource from "./labs/EditorialLab.html?raw";
import editorialLabDocument from "./labs/EditorialLab.comp.json";
import productionLabSource from "./labs/ProductionLab.html?raw";
import productionLabDocument from "./labs/ProductionLab.comp.json";
import heroFootageTimeline from "./HeroFootage.timeline.json";
import heroExcerptTimeline from "./HeroExcerpt.timeline.json";
import heroMainTimeline from "./HeroMain.timeline.json";
import gradeLabTimeline from "./labs/GradeLab.timeline.json";
import editorialLabTimeline from "./labs/EditorialLab.timeline.json";
import productionLabTimeline from "./labs/ProductionLab.timeline.json";
import heroRebuiltTimeline from "./HeroRebuilt.timeline.json";
import lowerThirdDocument from "./LowerThird.comp.json";
import endCardDocument from "./EndCard.comp.json";
import heroScriptDocument from "./HeroScript.comp.json";
import heroRebuiltDocument from "./HeroRebuilt.comp.json";
import { gsapMotionLabComp } from "./labs/GsapMotionLab";
import { productionLabGuide } from "./labs/ProductionLabGuide";
import { heroGradeVideoSetup } from "../effects/heroLooks";
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
export const gradeLabComp = defineComposition(gradeLabSource, {
  document: gradeLabDocument,
  timeline: defineTimelineDocument(gradeLabTimeline),
  setup: heroGradeVideoSetup,
  meta: {
    timelineFile: "src/compositions/labs/GradeLab.timeline.json",
    document: {
      file: "src/compositions/labs/GradeLab.comp.json",
      schema: "src/compositions/labs/GradeLab.schema.json",
      bindings: { desk: "/desk", tripod: "/tripod", keynote: "/keynote", "teal-wash": "/tealWash" },
      inspector: { title: "GRADE LAB LOOKS" },
    },
  },
});
export const heroFootageComp = defineComposition(heroFootageSource, {
  timeline: defineTimelineDocument(heroFootageTimeline),
  meta: { timelineFile: "src/compositions/HeroFootage.timeline.json" },
});
export const heroExcerptComp = defineComposition(excerptSource, {
  timeline: defineTimelineDocument(heroExcerptTimeline),
  meta: { timelineFile: "src/compositions/HeroExcerpt.timeline.json" },
});
export const directManipulationLabComp = defineComposition(directManipulationLabSource, {
  document: directManipulationLabDocument,
  meta: {
    authoring: { timeline: "hidden", transport: "always", directManipulation: true },
    document: {
      file: "src/compositions/labs/DirectManipulationLab.comp.json",
      schema: "src/compositions/labs/DirectManipulationLab.schema.json",
      bindings: {
        "lab-scene": "/scene",
        "lab-eyebrow": "/eyebrow",
        "lab-title": "/title",
        "lab-title-lead": "/titleLead",
        "lab-title-accent": "/titleAccent",
        "move-card": "/moveCard",
        "move-card-label": "/moveCardLabel",
        "move-card-title": "/moveCardTitle",
        "move-card-copy": "/moveCardCopy",
        "resize-card": "/resizeCard",
        "resize-card-label": "/resizeCardLabel",
        "resize-card-title": "/resizeCardTitle",
        "resize-card-copy": "/resizeCardCopy",
        "settings-card": "/settingsCard",
        "settings-card-label": "/settingsCardLabel",
        "settings-card-title": "/settingsCardTitle",
        "settings-card-copy": "/settingsCardCopy",
        "lab-hint": "/hint",
        "lab-hint-label": "/hintLabel",
        "lab-hint-copy": "/hintCopy",
      },
    },
  },
});
export const richPropertiesLabComp = defineComposition(richPropertiesLabSource, {
  document: richPropertiesLabDocument,
  meta: {
    authoring: { timeline: "hidden", transport: "hidden", directManipulation: true },
    document: {
      file: "src/compositions/labs/RichPropertiesLab.comp.json",
      schema: "src/compositions/labs/RichPropertiesLab.schema.json",
      bindings: {
        "rich-scene": "/scene",
        "rich-kicker": "/kicker",
        "rich-headline": "/headline",
        "gradient-panel": "/gradientPanel",
        "gradient-label": "/gradientLabel",
        "flex-panel": "/flexPanel",
        "flex-text": "/flexText",
        "flex-fill": "/flexFill",
        "flex-layout": "/flexLayout",
        "asset-panel": "/assetPanel",
        "asset-title": "/assetTitle",
        "asset-caption": "/assetCaption",
        "rich-caption": "/caption",
      },
    },
  },
});
export const editorialLabComp = defineComposition(editorialLabSource, {
  document: editorialLabDocument,
  timeline: defineTimelineDocument(editorialLabTimeline),
  meta: {
    timelineFile: "src/compositions/labs/EditorialLab.timeline.json",
    document: {
      file: "src/compositions/labs/EditorialLab.comp.json",
      schema: "src/compositions/labs/EditorialLab.schema.json",
      bindings: {
        "editorial-wash": "/wash",
        "editorial-glass-panel": "/glass",
        "editorial-kicker": "/kicker",
        "editorial-title": "/title",
        "editorial-caption": "/caption",
        "editorial-rank-1": "/rank1",
        "editorial-rank-2": "/rank2",
        "editorial-rank-4": "/rank4",
        "editorial-badge": "/badge",
        "editorial-grade": "/grade"
      },
      inspector: { title: "EDITORIAL LAB" },
    },
  },
});
type ProductionLabDocument = typeof productionLabDocument;
const productionDocumentSetup: CompositionSetup = ({ root, document: initial, onDocument, onCleanup }) => {
  const apply = (next: ProductionLabDocument) => {
    for (const index of [1, 2, 3, 4] as const) {
      const row = next[`graph${index}`];
      const values = { number: row.number, title: row.title, surface: row.surface };
      for (const [field, text] of Object.entries(values)) {
        const element = root.querySelector<HTMLElement>(`[data-fd-id="graph-${index}-${field}"]`);
        if (element) element.textContent = text;
      }
    }
    const number = root.querySelector<HTMLElement>("[data-fd-id=chapter-number]");
    const title = root.querySelector<HTMLElement>("[data-fd-id=chapter-title]");
    for (let index = 0; index <= 8; index += 1) {
      const chapter = next.chapters[`chapter${index}` as keyof typeof next.chapters];
      number?.setAttribute(`data-fd-prop-chapter-${index}`, chapter.number);
      title?.setAttribute(`data-fd-prop-chapter-${index}`, chapter.title);
    }
  };
  apply(initial as ProductionLabDocument);
  const stop = onDocument((next) => apply(next as ProductionLabDocument));
  onCleanup(stop);
};

export const productionLabComp = defineComposition(productionLabSource, {
  document: productionLabDocument,
  timeline: defineTimelineDocument(productionLabTimeline),
  setup: productionDocumentSetup,
  meta: {
    timelineFile: "src/compositions/labs/ProductionLab.timeline.json",
    deps: ["src/compositions/labs/ProductionLabGuide.ts"],
    document: {
      file: "src/compositions/labs/ProductionLab.comp.json",
      schema: "src/compositions/labs/ProductionLab.schema.json",
      bindings: {
        "production-generated-take": "/generatedTake",
        "production-intro-copy": "/introCopy",
        "production-kicker": "/kicker",
        "production-title-lead": "/titleLead",
        "production-title-accent": "/titleAccent",
        "production-summary": "/summary",
        "graph-1-number": "/graph1",
        "graph-1-title": "/graph1",
        "graph-1-surface": "/graph1",
        "graph-2-number": "/graph2",
        "graph-2-title": "/graph2",
        "graph-2-surface": "/graph2",
        "graph-3-number": "/graph3",
        "graph-3-title": "/graph3",
        "graph-3-surface": "/graph3",
        "graph-4-number": "/graph4",
        "graph-4-title": "/graph4",
        "graph-4-surface": "/graph4",
        "chapter-number": "/chapters",
        "chapter-title": "/chapters",
        "chapter-source": "/chapterSource",
        "production-bed": "/audio"
      },
      inspector: { title: "PRODUCTION LAB" },
    },
  },
}) as StudioComposition;
productionLabComp.meta = { ...productionLabComp.meta, guide: productionLabGuide };

const rebuiltClips = ["clip2", "clip3", "clip5", "clip4", "clip6"]
  .map((clip) => `<section data-fd-clip data-fd-id="${clip}"><canvas data-fd-grade-video></canvas></section>`)
  .join("");
export const heroRebuiltComp = defineComposition(
  `<!doctype html><html><head><style>[data-fd-composition],[data-fd-clip],canvas{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#000}</style></head><body><main data-fd-composition data-fd-id="HeroRebuilt" data-fd-width="1920" data-fd-height="1080" data-fd-fps="${FPS}" data-fd-duration="720" data-fd-kind="edit" data-fd-library="true">${rebuiltClips}</main></body></html>`,
  {
    document: heroRebuiltDocument,
    timeline: defineTimelineDocument(heroRebuiltTimeline),
    setup: heroGradeVideoSetup,
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

export { gsapMotionLabComp };
