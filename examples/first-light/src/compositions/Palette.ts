import { defineComposition } from "framediff";
import document from "./Palette.comp.json";
import source from "./Palette.html?raw";

export const paletteComp = defineComposition(source, {
  document,
  meta: {
    document: {
      file: "src/compositions/Palette.comp.json",
      schema: "src/compositions/Palette.schema.json",
      bindings: {
        "palette-eyebrow": "/eyebrow",
        "palette-title": "/title",
        "palette-body": "/body",
      },
    },
  },
});
