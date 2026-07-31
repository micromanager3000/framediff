import { defineComposition } from "framediff";
import document from "./Aperture.comp.json";
import source from "./Aperture.html?raw";

export const apertureComp = defineComposition(source, {
  document,
  meta: {
    document: {
      file: "src/compositions/Aperture.comp.json",
      schema: "src/compositions/Aperture.schema.json",
      bindings: {
        "aperture-mark": "/mark",
        "aperture-kicker": "/kicker",
        "aperture-title-wipe": "/titleWipe",
        "aperture-title": "/title",
        "aperture-rule": "/rule",
        "aperture-lede": "/lede",
      },
    },
  },
});
