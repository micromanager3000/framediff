import { defineThreeSceneComposition } from "framediff/three";
import { harborScene } from "./harborScene";

export const harborPrevizComp = defineThreeSceneComposition({
  scene: harborScene,
  id: "HarborPreviz",
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 240,
  background: "linear-gradient(180deg,#202b4a 0%,#131a2e 46%,#0d1120 100%)",
  cameras: [
    { id: "approach", name: "approach", camera: "approach", from: 0, durationInFrames: 90 },
    { id: "boat-chase", name: "boat chase", camera: "boat", from: 90, durationInFrames: 80 },
    { id: "from-lamp", name: "from the lamp", camera: "beacon", from: 170, durationInFrames: 70 },
  ],
  defaultCamera: "approach",
  meta: {
    file: "src/compositions/HarborPreviz.ts",
    module: "src/compositions/HarborPreviz.ts",
    exportName: "harborPrevizComp",
    deps: ["src/compositions/harborScene.ts"],
  },
});
