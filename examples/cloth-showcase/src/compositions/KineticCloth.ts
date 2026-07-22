import { defineComposition } from "framediff";
import source from "./KineticCloth.html?raw";
import document from "./KineticCloth.comp.json";
import { kineticPosterClothSetup } from "../effects/kineticPosterCloth";

export const kineticClothComposition = defineComposition(source, {
  setup: kineticPosterClothSetup,
  document,
  meta: {
    deps: ["src/effects/kineticPosterCloth.ts"],
    authoring: { timeline: "auto", directManipulation: true },
    document: {
      file: "src/compositions/KineticCloth.comp.json",
      schema: "src/compositions/KineticCloth.schema.json",
      bindings: {
        "cloth-surface": "/cloth",
        "poster-artwork": "/art",
      },
    },
  },
});
