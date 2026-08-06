import { defineCodeScene } from "framediff";
import source from "./MaterialPoster.html?raw";

export const materialPosterComposition = defineCodeScene(source, {
  capabilities: ["dom"],
  meta: {
    authoring: { timeline: "hidden", transport: "always", directManipulation: true },
  },
});
