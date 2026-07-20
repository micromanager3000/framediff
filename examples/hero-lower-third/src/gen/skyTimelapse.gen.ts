// A generative comp: this file IS the recipe. Prompt/params are source literals the
// Studio edits via literal rewrites; `take:` pins which generated output ships (the
// lockfile — takes live in framediff.assets.json with full provenance). Nothing here
// regenerates implicitly: the Studio's Generate button is the only paid action.

import { generative } from "framediff";

export const skyTimelapse = generative({
  id: "skyTimelapse",
  file: "src/gen/skyTimelapse.gen.ts",
  provider: "fal",
  model: "seedance-2.0",
  tier: "fast",
  prompt: "Timelapse of dusk clouds rolling over a city skyline, warm sodium glow rising from the streets below; locked-off wide shot, gentle film grain.",
  duration: 4,
  resolution: "720p",
  aspect: "16:9",
  audio: false,
  take: 1,
});
