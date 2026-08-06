import { defineThreeSceneComposition } from "framediff/three";
import { harborScene } from "./harborScene";
import data from "./HarborPreviz.scene.json";

export const harborPrevizComp = defineThreeSceneComposition({
  scene: harborScene,
  id: "HarborPreviz",
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 240,
  dataFile: "src/compositions/HarborPreviz.scene.json",
  data,
  meta: {
    file: "src/compositions/HarborPreviz.ts",
    module: "src/compositions/HarborPreviz.ts",
    exportName: "harborPrevizComp",
    deps: ["src/compositions/harborScene.ts"],
  },
});
