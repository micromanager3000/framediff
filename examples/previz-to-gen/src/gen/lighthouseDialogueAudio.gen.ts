import { generative, type GenRecipeData } from "framediff";
import data from "./lighthouseDialogueAudio.gen.json";

export const lighthouseDialogueAudio = generative({
  id: "lighthouseDialogueAudio",
  file: "src/gen/lighthouseDialogueAudio.gen.ts",
  dataFile: "src/gen/lighthouseDialogueAudio.gen.json",
  ...(data as GenRecipeData),
});
