import { defineStudioProject, type CompRegistry } from "framediff";
import { apertureComp, fieldComp, firstLightComp, ledgerComp, paletteComp } from "./compositions";
import { firstLightGuide } from "./compositions/FirstLightGuide";

export const composition = firstLightComp;
export const COMPOSITIONS: CompRegistry = {
  "first-light": firstLightComp,
  field: fieldComp,
  aperture: apertureComp,
  palette: paletteComp,
  ledger: ledgerComp,
};

/** What the Studio opens: these compositions, and the walkthrough that explains them. */
export const project = defineStudioProject({
  compositions: COMPOSITIONS,
  guide: firstLightGuide,
});
