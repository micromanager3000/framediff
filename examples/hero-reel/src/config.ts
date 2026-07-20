import type { CompRegistry } from "framediff";
import { lightTwistReelComp } from "./compositions/LightTwistReel";
import { reelRundownComp } from "./compositions/ReelRundown";

export const composition = lightTwistReelComp;
export const COMPOSITIONS: CompRegistry = {
  main: composition,
  // planning comp — an ordinary comp; its blocks window into the reel
  "reel-rundown": reelRundownComp,
};
