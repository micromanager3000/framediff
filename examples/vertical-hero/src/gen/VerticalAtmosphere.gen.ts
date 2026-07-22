import { generative, type GenRecipeData } from "framediff";
import data from "./VerticalAtmosphere.gen.json";

export const verticalAtmosphere = generative({
  id: "VerticalAtmosphere",
  file: "src/gen/VerticalAtmosphere.gen.ts",
  dataFile: "src/gen/VerticalAtmosphere.gen.json",
  ...(data as GenRecipeData),
});
