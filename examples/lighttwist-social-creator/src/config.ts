import type { CompRegistry } from "framediff";
import { creatorSocialComp } from "./compositions/CreatorSocial";

export const composition = creatorSocialComp;
export const COMPOSITIONS: CompRegistry = {
  "creator-social": composition,
};
