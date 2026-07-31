import { defineComposition } from "framediff";
import document from "./Field.comp.json";
import source from "./Field.html?raw";

export const fieldComp = defineComposition(source, {
  document,
  meta: {
    document: {
      file: "src/compositions/Field.comp.json",
      schema: "src/compositions/Field.schema.json",
      bindings: {
        "field-violet": "/violet",
        "field-amber": "/amber",
        "field-teal": "/teal",
        "field-deep": "/deep",
        "field-horizon": "/horizon",
      },
    },
  },
});
