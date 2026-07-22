import { defineComposition } from "framediff";
import document from "./VerticalLowerThird.comp.json";
import source from "./VerticalLowerThird.html?raw";

export const verticalLowerThirdComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/VerticalLowerThird.comp.json",
    schema: "src/compositions/VerticalLowerThird.schema.json",
    bindings: {
      "lower-panel": "/panel",
      "lower-accent": "/accent",
      "lower-eyebrow": "/eyebrow",
      "lower-name": "/name",
      "lower-role": "/role"
    }
  } },
});
