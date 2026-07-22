import { defineComposition, defineTimelineDocument } from "framediff";
import source from "./VerticalMain.html?raw";
import timeline from "./VerticalMain.timeline.json";

export const verticalMainComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  meta: { timelineFile: "src/compositions/VerticalMain.timeline.json" },
});
