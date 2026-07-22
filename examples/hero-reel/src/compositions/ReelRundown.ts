import { defineComposition } from "framediff";
import source from "./ReelRundown.html?raw";
import document from "./ReelRundown.comp.json";

export const reelRundownComp = defineComposition(source, {
  document,
  meta: { document: {
    file: "src/compositions/ReelRundown.comp.json",
    schema: "src/compositions/ReelRundown.schema.json",
    bindings: { "reel-rundown-title": "/title" },
  } },
});
