import type { CompRegistry } from "framediff";
import { lightTwistReelComp } from "./compositions/LightTwistReel";

export const composition = lightTwistReelComp;
export const COMPOSITIONS: CompRegistry = { main: composition };
