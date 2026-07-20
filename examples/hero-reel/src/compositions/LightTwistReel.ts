import { defineComposition } from "framediff";
import source from "./LightTwistReel.html?raw";
import { lightTwistFinishSetup } from "../effects/lightTwistFinish";

export const lightTwistReelComp = defineComposition(source, {
  setup: lightTwistFinishSetup,
  meta: { deps: ["src/data/edl.ts", "src/effects/lightTwistFinish.ts"] },
});
