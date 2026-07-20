import { defineComposition } from "framediff";
import source from "./KineticCloth.html?raw";
import { kineticPosterClothSetup } from "../effects/kineticPosterCloth";

export const kineticClothComposition = defineComposition(source, {
  setup: kineticPosterClothSetup,
  meta: { deps: ["src/effects/kineticPosterCloth.ts"] },
});
