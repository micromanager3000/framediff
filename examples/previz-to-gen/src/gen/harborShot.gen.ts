// Executable registration stays here; mutable recipe data and references live in the adjacent JSON.
// The `comp://harbor-previz` input bakes on submit (a current bake is reused, a stale one
// re-exports first), so editing the scene and hitting Generate is the whole loop. The prompt
// casts the reference as a layout-only blockout: r2v transfers appearance as eagerly as it
// transfers motion, so the words must revoke the previz's CG look — name the ref as previz,
// demand live-action surfaces, and describe the beam as light (not the cone geometry).
//
// JSON `take` pins which generated output ships (the lockfile — takes live in framediff.assets.json
// with full provenance). Nothing regenerates implicitly: the Studio's Generate button is the
// only paid action, and it needs a fal key (⚿ SERVICES in the topbar, or FAL_KEY).

import { generative, type GenRecipeData } from "framediff";
import data from "./harborShot.gen.json";

export const harborShot = generative({
  id: "harborShot",
  file: "src/gen/harborShot.gen.ts",
  dataFile: "src/gen/harborShot.gen.json",
  ...(data as GenRecipeData),
});
