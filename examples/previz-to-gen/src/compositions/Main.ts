import { defineComposition, defineTimelineDocument } from "framediff";
import source from "./Main.html?raw";
import timeline from "./Main.timeline.json";

export const mainComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  meta: { timelineFile: "src/compositions/Main.timeline.json" },
});
