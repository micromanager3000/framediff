import type { CompRegistry } from "framediff";
import { blazerRelight } from "./gen/blazerRelight.gen";
import { skyTimelapse } from "./gen/skyTimelapse.gen";
import { baseRegistry, composition } from "./compositions";
export { composition };
export const COMPOSITIONS: CompRegistry = { ...baseRegistry, skyTimelapse, blazerRelight, };
