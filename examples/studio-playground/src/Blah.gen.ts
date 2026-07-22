import { generative, type GenRecipeData } from "framediff";
import data from "./Blah.gen.json";

export const blahComp = generative({
  id: "Blah",
  file: "src/Blah.gen.ts",
  dataFile: "src/Blah.gen.json",
  ...(data as GenRecipeData),
});
