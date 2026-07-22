import type { CompRegistry } from "framediff";
import { COMPOSITIONS } from "./config";

let liveCompositions: CompRegistry = COMPOSITIONS;
if (import.meta.hot) {
  import.meta.hot.accept("./config", (module) => {
    if (module) liveCompositions = module.COMPOSITIONS;
  });
}

export const compositions = (): CompRegistry => liveCompositions;
