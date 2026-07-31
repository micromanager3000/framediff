import { defineComposition } from "framediff";
import source from "./MaterialPoster.html?raw";

export const materialPosterComposition = defineComposition(source, {
  meta: {
    authoring: { timeline: "hidden", transport: "always", directManipulation: true },
  },
});
