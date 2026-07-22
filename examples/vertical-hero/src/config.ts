import type { CompRegistry } from "framediff";
import { verticalAtmosphere } from "./gen/VerticalAtmosphere.gen";
import { verticalBackdropComp, verticalLowerThirdComp, verticalMainComp } from "./compositions";

export const composition = verticalMainComp;
export const COMPOSITIONS: CompRegistry = {
  "vertical-main": verticalMainComp,
  "vertical-backdrop": verticalBackdropComp,
  "vertical-lower-third": verticalLowerThirdComp,
  "vertical-atmosphere": verticalAtmosphere,
};
