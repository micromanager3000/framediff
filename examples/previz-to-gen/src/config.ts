// The composition registry — wires composition components to their dimensions, fps, and length.
// This file is the example's orchestration entry point; the pipeline it registers:
//   harbor-previz (three.js, 3 cameras) → bake → harborShot (Seedance r2v) → main (the edit).

import type { CompRegistry } from "framediff";
import { mainComp } from "./compositions/Main";
import { harborPrevizComp } from "./compositions/HarborPreviz";
import { moodboardComp } from "./compositions/Moodboard";
import { scriptComp } from "./compositions/Script";
import { storyboardComp } from "./compositions/Storyboard";
import { locationsComp } from "./compositions/Locations";
import { castComp } from "./compositions/Cast";
import { harborShot } from "./gen/harborShot.gen";

/** The Studio registry. "main" is the root edit — the top of the stack; ?comp= picks which
 *  comp to open, and every comp stays reachable in the tree. */
export const COMPOSITIONS: CompRegistry = {
  main: mainComp,
  // pre-production comps — ordinary comps in the same graph: the script's rows nest the
  // take/previz they reference, location cards are live cameras into the previz set, the
  // boat's cast card nests its pinned take.
  moodboard: moodboardComp,
  script: scriptComp,
  storyboard: storyboardComp,
  locations: locationsComp,
  cast: castComp,
  "harbor-previz": harborPrevizComp,
  // generative comps — recipes in src/gen/*.gen.ts, takes pinned in framediff.assets.json
  harborShot,
};
