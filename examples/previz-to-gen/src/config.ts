// The composition registry — wires composition components to their dimensions, fps, and length.
// This file is the example's orchestration entry point; the pipeline it registers:
//   harbor-previz (three.js, 3 cameras) → bake → harborShot (Seedance r2v) → main (the edit).

import type { CompRegistry } from "framediff";
import { mainComp } from "./compositions/Main";
import { harborPrevizComp } from "./compositions/HarborPreviz";
import { moodboardComp } from "./compositions/Moodboard";
import { scriptComp } from "./compositions/Script";
import { locationsComp } from "./compositions/Locations";
import { castComp } from "./compositions/Cast";
import { lighthouseConceptComp } from "./compositions/LighthouseConcept";
import { lighthouseWorkflowComp } from "./compositions/LighthouseWorkflow";
import { lighthouseWorkflowStepsComp } from "./compositions/LighthouseWorkflowSteps";
import { harborShot } from "./gen/harborShot.gen";
import { lighthouseVisitor } from "./gen/lighthouseVisitor.gen";
import { lighthouseKeeper } from "./gen/lighthouseKeeper.gen";
import { lighthouseDialogueAudio } from "./gen/lighthouseDialogueAudio.gen";
import { lighthouseDialogue } from "./gen/lighthouseDialogue.gen";

/** The Studio registry. The first entry is also the runtime fallback; every other composition
 *  stays reachable from the project rail. */
export const COMPOSITIONS = {
  "lighthouse-workflow": lighthouseWorkflowComp,
  "lighthouse-workflow-steps": lighthouseWorkflowStepsComp,
  main: mainComp,
  // pre-production comps — ordinary comps in the same graph: the script's rows nest the
  // take/previz they reference, location cards are live cameras into the previz set, the
  // boat's cast card nests its pinned take.
  moodboard: moodboardComp,
  script: scriptComp,
  locations: locationsComp,
  cast: castComp,
  "harbor-previz": harborPrevizComp,
  "lighthouse-concept": lighthouseConceptComp,
  // generative comps — recipes in src/gen/*.gen.ts, takes pinned in framediff.assets.json
  harborShot,
  "lighthouse-visitor": lighthouseVisitor,
  "lighthouse-keeper": lighthouseKeeper,
  "lighthouse-dialogue-audio": lighthouseDialogueAudio,
  "lighthouse-dialogue": lighthouseDialogue,
} satisfies CompRegistry;

/** The composition served at the project URL. */
export const PROJECT_ROOT: keyof typeof COMPOSITIONS = "lighthouse-workflow";
