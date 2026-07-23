import type { CompRegistry } from "framediff";
import { createStudioRuntime } from "framediff/studio-runtime";
import { COMPOSITIONS, PROJECT_ROOT } from "../config";
import "../main";
export const studioRuntime = createStudioRuntime(COMPOSITIONS);
// Keep the page behind this accepted module boundary. Importing config from +page.svelte
// would remount the entire Studio whenever an editable JSON document (such as a moodboard)
// updates one of config's transitive imports.
export const projectRoot = PROJECT_ROOT;
if (import.meta.hot) import.meta.hot.accept("../config", (module) => module && studioRuntime.replaceRegistry(module.COMPOSITIONS as CompRegistry));
