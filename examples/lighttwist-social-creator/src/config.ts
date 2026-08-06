import { defineCompositionRegistry } from "framediff";
import { creatorSocialComp } from "./compositions/CreatorSocial";

export const composition = creatorSocialComp;
export const COMPOSITIONS = defineCompositionRegistry({
  "creator-social": composition,
});
