import type { CompRegistry } from "framediff";
import { kineticClothComposition } from "./compositions/KineticCloth";

export const composition = kineticClothComposition;
export const COMPOSITIONS: CompRegistry = { "kinetic-cloth": composition };
