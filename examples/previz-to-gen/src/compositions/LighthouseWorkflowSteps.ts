import { defineCodeScene } from "framediff";
import source from "./LighthouseWorkflowSteps.html?raw";

export const lighthouseWorkflowStepsComp = defineCodeScene(source, {
  capabilities: ["dom"],
});
