import { defineMoodboardComposition, type MoodboardData } from "framediff";
import board from "../data/lighthouse-board.json";

const seed: MoodboardData = board as MoodboardData;

export const lighthouseConceptComp = defineMoodboardComposition(seed, {
  id: "LighthouseConcept",
  name: "Lighthouse dialogue — reference board",
  title: "Lighthouse dialogue — reference board",
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 420,
  boardWidth: 2200,
  boardHeight: 1300,
  dataFile: "src/data/lighthouse-board.json",
  file: "src/compositions/LighthouseConcept.ts",
  module: "src/compositions/LighthouseConcept.ts",
  exportName: "lighthouseConceptComp",
  library: true,
});
