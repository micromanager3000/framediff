import { defineComposition, defineTimelineDocument } from "framediff";
import source from "./LighthouseWorkflow.html?raw";
import timeline from "./LighthouseWorkflow.timeline.json";

export const lighthouseWorkflowComp = defineComposition(source, {
  timeline: defineTimelineDocument(timeline),
  meta: { timelineFile: "src/compositions/LighthouseWorkflow.timeline.json" },
});
