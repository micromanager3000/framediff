import { defineComposition, defineTimelineDocument } from "framediff";
import source from "./PlanLab.html?raw";
import document from "./PlanLab.comp.json";
import timeline from "./PlanLab.timeline.json";

export const planLabComp = defineComposition(source, {
  document,
  timeline: defineTimelineDocument(timeline),
  meta: {
    timelineFile: "src/compositions/playground/PlanLab.timeline.json",
    document: {
      file: "src/compositions/playground/PlanLab.comp.json",
      schema: "src/compositions/playground/PlanLab.schema.json",
      bindings: { "plan-title": "/title", "plan-open-copy": "/beat1", "plan-demo-copy": "/beat2", "plan-close-copy": "/beat3" },
    },
  },
});
