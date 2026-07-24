import {
  createGradeVideoSetup,
  defineComposition,
  defineTimelineDocument,
} from "framediff";
import source from "./CreatorSocial.html?raw";
import document from "./CreatorSocial.comp.json";
import timeline from "./CreatorSocial.timeline.json";

const documentIds = [
  "hook-kicker",
  "hook-line-one",
  "hook-line-two",
  "reveal-line-one",
  "reveal-line-two",
  "proof-chip-one",
  "proof-chip-two",
  "end-brand",
  "end-line-one",
  "end-line-two",
  "end-cta",
  "end-url",
  "music-bed",
  "reveal-shine",
];

export const creatorSocialComp = defineComposition(source, {
  document,
  timeline: defineTimelineDocument(timeline),
  setup: createGradeVideoSetup({ lut: "gold" }),
  meta: {
    timelineFile: "src/compositions/CreatorSocial.timeline.json",
    document: {
      file: "src/compositions/CreatorSocial.comp.json",
      schema: "src/compositions/CreatorSocial.schema.json",
      bindings: Object.fromEntries(documentIds.map((id) => [id, `/${id}`])),
      inspector: { title: "CREATOR SOCIAL · 9:16" },
    },
  },
});
