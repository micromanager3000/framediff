import { generative, type GenRecipeData } from "framediff";
import data from "./lighthouseDialogue.gen.json";

export const lighthouseDialogue = generative({
  id: "lighthouseDialogue",
  file: "src/gen/lighthouseDialogue.gen.ts",
  dataFile: "src/gen/lighthouseDialogue.gen.json",
  ...(data as GenRecipeData),
});
