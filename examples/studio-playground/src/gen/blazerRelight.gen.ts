// Reference-to-video: conditions on real project footage (the blazer proxy) — the ref
// is an asset:// id from framediff.assets.json; the dev bridge resolves it to bytes from
// the configured local cache and uploads it to the provider at submit time. Video refs price at 0.6×.

import { generative, type GenRecipeData } from "framediff";
import data from "./blazerRelight.gen.json";

export const blazerRelight = generative({
  id: "blazerRelight",
  file: "src/gen/blazerRelight.gen.ts",
  dataFile: "src/gen/blazerRelight.gen.json",
  ...(data as GenRecipeData),
});
