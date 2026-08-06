import { defineCompositionRegistry } from "framediff";
import { blazerRelight } from "./gen/blazerRelight.gen";
import { skyTimelapse } from "./gen/skyTimelapse.gen";
import { baseRegistry, composition } from "./compositions";
import { testComp } from "./Test.gen";
import { blahComp } from "./Blah.gen";
export { composition };
export const COMPOSITIONS = defineCompositionRegistry({ ...baseRegistry, skyTimelapse, blazerRelight, "test": testComp, "blah": blahComp });
