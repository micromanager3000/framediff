import { defineComposition } from "framediff";
import source from "./Locations.html?raw";
import document from "./Locations.comp.json";

export const locationsComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/Locations.comp.json",
    schema: "src/compositions/ReferenceTitle.schema.json",
    bindings: { "locations-title": "/title" },
  } },
});
