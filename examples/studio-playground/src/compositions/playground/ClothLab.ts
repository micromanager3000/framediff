import { createClothSetup, defineComposition } from "framediff";
import source from "./ClothLab.html?raw";

const clothSetup = createClothSetup({
  textureRefresh: "frame",
  texturePixelRatio: 1,
  hideSource: true,
  simulation: {
    width: 3.6,
    height: 2.02,
    segmentsX: 22,
    segmentsY: 14,
    mass: 0.9,
    gravity: [0, -2.1, 0],
    wind: (time) => [Math.sin(time * 1.4) * 1.2, Math.cos(time * 0.8) * 0.16, 3.2 + Math.sin(time * 2.1) * 1.9],
    damping: 0.045,
    stiffness: 0.93,
    shearStiffness: 0.8,
    bendStiffness: 0.3,
    substeps: 3,
    iterations: 6,
    pins: "corners",
    seed: 2070,
    initialPerturbation: 0.008,
    checkpointIntervalFrames: 24,
    impulses: [
      { frame: 48, uv: [0.24, 0.38], force: [7, 3, 26], radius: 0.24 },
      { frame: 132, uv: [0.72, 0.58], force: [-6, 5, -22], radius: 0.22 },
    ],
    colliders: [
      { type: "sphere", center: (time) => [-2.1 + Math.min(1, Math.max(0, (time - 1.4) / 3.2)) * 4.2, -0.1, -0.28], radius: 0.46 },
      { type: "plane", normal: [0, 1, 0], offset: -1.28 },
    ],
  },
  camera: { position: [0, 0.03, 4.25], target: [0, -0.04, 0], fov: 32 },
  material: { roughness: 0.76, metalness: 0.03, emissive: 0x101408, emissiveIntensity: 0.1, transparent: true },
  ambientLight: { color: 0xeaf6dc, intensity: 1.15 },
  directionalLight: { color: 0xfff0d0, intensity: 2.7, position: [-2.8, 3.8, 4.4] },
  clearAlpha: 0,
});

export const clothLabComp = defineComposition(source, {
  setup: clothSetup,
  meta: { deps: ["src/compositions/playground/ClothLab.ts"] },
});
