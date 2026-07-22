import { defineComposition } from "framediff";
import source from "./Script.html?raw";
import document from "./Script.comp.json";

export const scriptComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/Script.comp.json",
    schema: "src/compositions/ReferenceTitle.schema.json",
    bindings: { "script-title": "/title" },
  } },
});
