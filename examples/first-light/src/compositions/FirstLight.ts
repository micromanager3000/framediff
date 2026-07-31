import { defineComposition, defineTimelineDocument, type StudioComposition } from "framediff";
import source from "./FirstLight.html?raw";
import timeline from "./FirstLight.timeline.json";
import { firstLightGuide } from "./FirstLightGuide";

export const firstLightComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  meta: {
    timelineFile: "src/compositions/FirstLight.timeline.json",
    deps: ["src/compositions/FirstLightGuide.ts"],
  },
}) as StudioComposition;

// The walkthrough rides on the root composition, so it is reachable from every leaf.
firstLightComp.meta = { ...firstLightComp.meta, guide: firstLightGuide };
