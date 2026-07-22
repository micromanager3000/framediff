import { defineComposition } from "framediff";
import source from "./Cast.html?raw";
import document from "./Cast.comp.json";

export const castComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/Cast.comp.json",
    schema: "src/compositions/ReferenceTitle.schema.json",
    bindings: { "cast-title": "/title" },
  } },
});
