import { defineComposition } from "framediff";
import document from "./Ledger.comp.json";
import source from "./Ledger.html?raw";

export const ledgerComp = defineComposition(source, {
  document,
  meta: {
    document: {
      file: "src/compositions/Ledger.comp.json",
      schema: "src/compositions/Ledger.schema.json",
      bindings: {
        "ledger-eyebrow": "/eyebrow",
        "ledger-title": "/title",
        "ledger-pip": "/pip",
        "ledger-verdict": "/verdict",
        "ledger-note": "/note",
      },
    },
  },
});
