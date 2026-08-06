import { defineCompositionRegistry } from "framediff";
import { verticalAtmosphere } from "./gen/VerticalAtmosphere.gen";
import { verticalBackdropComp, verticalLowerThirdComp, verticalMainComp } from "./compositions";

export const composition = verticalMainComp;
export const COMPOSITIONS = defineCompositionRegistry({
  "vertical-main": verticalMainComp,
  "vertical-backdrop": verticalBackdropComp,
  "vertical-lower-third": verticalLowerThirdComp,
  "vertical-atmosphere": verticalAtmosphere,
});
