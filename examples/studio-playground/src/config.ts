import { defineStudioProject, type CompRegistry } from "framediff";
import { blazerRelight } from "./gen/blazerRelight.gen";
import { skyTimelapse } from "./gen/skyTimelapse.gen";
import { baseRegistry, composition } from "./compositions";
import { studioPlaygroundGuide } from "./compositions/playground/StudioPlaygroundGuide";
export { composition };
export const COMPOSITIONS: CompRegistry = { ...baseRegistry, skyTimelapse, blazerRelight, };

/** What the Studio opens: every composition here, under one walkthrough. */
export const project = defineStudioProject({
  compositions: COMPOSITIONS,
  guide: studioPlaygroundGuide,
});
