import { defineCompositionRegistry } from "framediff";
import { baseRegistry, composition } from "./compositions";
export { composition };
export const COMPOSITIONS = defineCompositionRegistry({ ...baseRegistry });
