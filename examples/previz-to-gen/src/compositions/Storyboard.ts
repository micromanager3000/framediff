import { defineComposition } from "framediff";
import source from "./Storyboard.html?raw";
import document from "./Storyboard.comp.json";

export const storyboardComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/Storyboard.comp.json",
    schema: "src/compositions/ReferenceTitle.schema.json",
    bindings: { "storyboard-title": "/title" },
  } },
});
