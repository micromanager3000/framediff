import { generative, type GenRecipeData } from "framediff";
import data from "./lighthouseKeeper.gen.json";

export const lighthouseKeeper = generative({
  id: "lighthouseKeeper",
  file: "src/gen/lighthouseKeeper.gen.ts",
  dataFile: "src/gen/lighthouseKeeper.gen.json",
  ...(data as GenRecipeData),
});
