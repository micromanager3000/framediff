import type { CompRegistry } from "framediff";
import { heroRawComp } from "./HeroRaw";
import { heroPlaneShotComps } from "./HeroPlane3D";
import {
  composition,
  endCardComp,
  heroExcerptComp,
  heroFootageComp,
  heroRebuiltComp,
  heroScriptComp,
  lowerThirdComp,
} from "./StaticCompositions";
export {
  composition,
  endCardComp,
  heroExcerptComp,
  heroFootageComp,
  heroPlaneShotComps,
  heroRawComp,
  heroRebuiltComp,
  heroScriptComp,
  lowerThirdComp,
};

export const baseRegistry: CompRegistry = {
  main: composition,
  "hero-script": heroScriptComp,
  hero: heroRawComp,
  "hero-raw": heroRawComp,
  "hero-footage-reference": heroFootageComp,
  "hero-rebuilt": heroRebuiltComp,
  "lower-third": lowerThirdComp,
  "end-card": endCardComp,
  excerpt: heroExcerptComp,
  ...heroPlaneShotComps,
};
