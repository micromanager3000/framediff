import { defineComposition, defineTimelineDocument } from "framediff";
import source from "./LightTwistReel.html?raw";
import timeline from "./LightTwistReel.timeline.json";
import { lightTwistFinishSetup } from "../effects/lightTwistFinish";

export const lightTwistReelComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  setup: lightTwistFinishSetup,
  meta: {
    timelineFile: "src/compositions/LightTwistReel.timeline.json",
    deps: ["src/data/edl.ts", "src/effects/lightTwistFinish.ts"],
  },
});
