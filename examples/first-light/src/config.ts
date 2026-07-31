import type { CompRegistry } from "framediff";
import { apertureComp, fieldComp, firstLightComp, ledgerComp, paletteComp } from "./compositions";

export const composition = firstLightComp;
export const COMPOSITIONS: CompRegistry = {
  "first-light": firstLightComp,
  field: fieldComp,
  aperture: apertureComp,
  palette: paletteComp,
  ledger: ledgerComp,
};
