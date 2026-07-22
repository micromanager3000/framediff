import { defineComposition } from "framediff";
import source from "./DetCheck.html?raw";
import document from "./DetCheck.comp.json";

export const detCheckComposition = defineComposition(source, {
  document,
  meta: {
    document: {
      file: "src/compositions/DetCheck.comp.json",
      schema: "src/compositions/DetCheck.schema.json",
      bindings: { "procedural-dot": "/params" },
    },
  },
});
