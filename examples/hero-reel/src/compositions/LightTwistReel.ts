import { defineComposition, defineTimelineDocument } from "framediff";
import source from "./LightTwistReel.html?raw";
import document from "./LightTwistReel.comp.json";
import timeline from "./LightTwistReel.timeline.json";
import { lightTwistFinishSetup } from "../effects/lightTwistFinish";

const documentIds = [
  ...["01", "02", "03", "04a", "04b", "04c", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"].map((id) => `shot-${id}-look`),
  "caption-meeting-line-1",
  "caption-meeting-line-2",
  "caption-background-text",
  "caption-media-text",
  "caption-cameras-text",
  "caption-camera-text",
  "lower-third-copy",
  "lower-third-brand",
  "logo-text",
  "closing-text",
  "end-card-line",
  "end-card-url",
  "music-bed",
  "shine",
  "logo-reveal",
  "end-shine",
];

export const lightTwistReelComp = defineComposition(source, {
  document,
  timeline: defineTimelineDocument(timeline),
  setup: lightTwistFinishSetup,
  meta: {
    timelineFile: "src/compositions/LightTwistReel.timeline.json",
    deps: ["src/data/edl.ts", "src/effects/lightTwistFinish.ts"],
    document: {
      file: "src/compositions/LightTwistReel.comp.json",
      schema: "src/compositions/LightTwistReel.schema.json",
      bindings: Object.fromEntries(documentIds.map((id) => [id, `/${id}`])),
      inspector: { title: "LIGHTTWIST REEL" },
    },
  },
});
