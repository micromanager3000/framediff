import { generative, type GenRecipeData } from "framediff";
import data from "./Test.gen.json";

export const testComp = generative({
  id: "Test",
  file: "src/Test.gen.ts",
  dataFile: "src/Test.gen.json",
  ...(data as GenRecipeData),
});
