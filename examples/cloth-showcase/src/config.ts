import { defineCompositionRegistry } from "framediff";
import { kineticClothComposition } from "./compositions/KineticCloth";
import { materialPosterComposition } from "./compositions/MaterialPoster";

export const composition = kineticClothComposition;
export const COMPOSITIONS = defineCompositionRegistry({
  "kinetic-cloth": composition,
  "material-poster": materialPosterComposition,
});
