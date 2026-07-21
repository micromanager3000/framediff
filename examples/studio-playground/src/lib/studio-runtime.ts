import type { CompRegistry } from "framediff";
import { createStudioRuntime } from "framediff/studio-runtime";
import { COMPOSITIONS } from "../config";
import "../main";
export const studioRuntime = createStudioRuntime(COMPOSITIONS);
if (import.meta.hot) import.meta.hot.accept("../config", (module) => module && studioRuntime.replaceRegistry(module.COMPOSITIONS as CompRegistry));
