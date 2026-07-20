import { createClothSetup } from "framediff";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeInOut = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Project-owned art-direction preset; the solver, renderer, and capture lifecycle stay packaged. */
export const kineticPosterClothSetup = createClothSetup({
  textureRefresh: "frame",
  texturePixelRatio: 1,
  hideSource: true,
  simulation: {
    width: 3.6,
    height: 2.15,
    segmentsX: 26,
    segmentsY: 16,
    mass: 0.86,
    gravity: [0, -2.35, 0],
    wind: (time) => [
      Math.sin(time * 1.35) * 1.15 + Math.sin(time * 3.2) * 0.24,
      Math.cos(time * 0.82) * 0.18,
      3.4 + Math.sin(time * 1.8) * 2.2 + Math.sin(time * 5.1) * 0.55,
    ],
    damping: 0.044,
    stiffness: 0.94,
    shearStiffness: 0.82,
    bendStiffness: 0.28,
    substeps: 3,
    iterations: 6,
    pins: "corners",
    seed: 2026,
    initialPerturbation: 0.008,
    checkpointIntervalFrames: 24,
    impulses: [
      { frame: 38, uv: [0.22, 0.34], force: [8, 3, 31], radius: 0.24 },
      { frame: 102, uv: [0.72, 0.55], force: [-7, 5, -25], radius: 0.21 },
      { frame: 164, uv: [0.46, 0.72], force: [3, 8, 24], radius: 0.27 },
    ],
    colliders: [
      {
        type: "sphere",
        center: (time) => {
          const travel = easeInOut((time - 1.55) / 3.1);
          return [-2.35 + travel * 4.7, Math.sin(travel * Math.PI) * 0.18 - 0.05, -0.3];
        },
        radius: 0.48,
      },
      { type: "plane", normal: [0, 1, 0], offset: -1.34 },
    ],
  },
  camera: { position: [0, 0.02, 4.2], target: [0, -0.03, 0], fov: 32 },
  material: {
    roughness: 0.76,
    metalness: 0.04,
    emissive: 0x111408,
    emissiveIntensity: 0.1,
    transparent: true,
  },
  ambientLight: { color: 0xeaf6dc, intensity: 1.2 },
  directionalLight: { color: 0xfff1cf, intensity: 2.8, position: [-2.7, 3.8, 4.5] },
  clearAlpha: 0,
});
