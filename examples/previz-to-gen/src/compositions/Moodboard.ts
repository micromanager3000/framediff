import { defineMoodboardComposition, type MoodboardData } from "framediff";
import board from "../data/board.json";

// The board's content lives in src/data/board.json — read live by the stock moodboard
// surface (canvas, pan, zoom, minimap, drag, in-place text editing) and written back on
// every edit, so board changes review as data diffs. The seed below only covers
// contexts where the dev filesystem is unavailable.
const seed: MoodboardData = board as MoodboardData;

export const moodboardComp = defineMoodboardComposition(seed, {
  id: "Moodboard",
  name: "Harbor short — scratchpad",
  title: "Harbor short — scratchpad",
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 240,
  dataFile: "src/data/board.json",
  file: "src/compositions/Moodboard.ts",
  module: "src/compositions/Moodboard.ts",
  exportName: "moodboardComp",
});
