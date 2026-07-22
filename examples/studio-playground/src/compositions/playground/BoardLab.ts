import { defineComposition } from "framediff";
import source from "./BoardLab.html?raw";
import document from "./BoardLab.comp.json";

export const boardLabComp = defineComposition(source, {
  document,
  meta: {
    document: {
      file: "src/compositions/playground/BoardLab.comp.json",
      schema: "src/compositions/playground/BoardLab.schema.json",
      bindings: { "board-title": "/title", "board-camera": "/camera", "board-subject": "/subject", "board-light": "/light" },
    },
  },
});
