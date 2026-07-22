// Executable registration stays here. Prompt, params, refs, and the pinned take live in
// skyTimelapse.gen.json, so Studio edits are document-only and never imply generation.

import { generative, type GenRecipeData } from "framediff";
import data from "./skyTimelapse.gen.json";

export const skyTimelapse = generative({
  id: "skyTimelapse",
  file: "src/gen/skyTimelapse.gen.ts",
  dataFile: "src/gen/skyTimelapse.gen.json",
  ...(data as GenRecipeData),
});
