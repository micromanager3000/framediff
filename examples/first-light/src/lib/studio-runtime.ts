import type { StudioProject } from "framediff";
import { createStudioRuntime } from "framediff/studio-runtime";
import { project } from "../config";
import "../main";

export const studioRuntime = createStudioRuntime(project);
if (import.meta.hot) {
  import.meta.hot.accept("../config", (module) => {
    if (module) studioRuntime.replaceProject(module.project as StudioProject);
  });
}
