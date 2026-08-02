import { defineComposition, defineTimelineDocument, type StudioComposition } from "framediff";
import source from "./FirstLight.html?raw";
import timeline from "./FirstLight.timeline.json";

export const firstLightComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  meta: {
    timelineFile: "src/compositions/FirstLight.timeline.json",
  },
}) as StudioComposition;
