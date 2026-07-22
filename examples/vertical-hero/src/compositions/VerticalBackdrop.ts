import { defineComposition } from "framediff";
import document from "./VerticalBackdrop.comp.json";
import source from "./VerticalBackdrop.html?raw";

export const verticalBackdropComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/VerticalBackdrop.comp.json",
    schema: "src/compositions/VerticalBackdrop.schema.json",
    bindings: {
      "backdrop-headline": "/headline",
      "backdrop-kicker": "/kicker",
      "backdrop-orb-a": "/orbA",
      "backdrop-orb-b": "/orbB"
    }
  } },
});
