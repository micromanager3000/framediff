import { generative, type GenRecipeData } from "framediff";
import data from "./lighthouseVisitor.gen.json";

export const lighthouseVisitor = generative({
  id: "lighthouseVisitor",
  file: "src/gen/lighthouseVisitor.gen.ts",
  dataFile: "src/gen/lighthouseVisitor.gen.json",
  ...(data as GenRecipeData),
});
