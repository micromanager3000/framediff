import {
  createClothSetup,
  type ClothSetupOptions,
  type CompositionSetup,
} from "framediff";
import initialDocument from "../compositions/KineticCloth.comp.json";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeInOut = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

interface KineticClothDocument {
  cloth: {
    x: number;
    y: number;
    width: number;
    height: number;
    gravityY: number;
    windBase: number;
    windGust: number;
    windSpeed: number;
    flutter: number;
    damping: number;
    stiffness: number;
    shearStiffness: number;
    bendStiffness: number;
    substeps: number;
    iterations: number;
    pins: "none" | "top" | "corners";
    roughness: number;
    metalness: number;
    iridescence: number;
    clearcoat: number;
    clearcoatRoughness: number;
    sheen: number;
    cameraFov: number;
  };
  art: { accent: string; secondary: string; showGrid: boolean };
}

const fallbackDocument = initialDocument as KineticClothDocument;

function optionsFor(document: KineticClothDocument): ClothSetupOptions {
  const settings = document.cloth;
  return {
    textureRefresh: "frame",
    texturePixelRatio: 1,
    hideSource: true,
    simulation: {
      width: 3.6,
      height: 2.15,
      segmentsX: 26,
      segmentsY: 16,
      mass: 0.86,
      gravity: [0, settings.gravityY, 0],
      wind: (time) => [
        Math.sin(time * 1.35 * settings.windSpeed) * settings.windBase * 0.34
          + Math.sin(time * 3.2 * settings.windSpeed) * settings.flutter,
        Math.cos(time * 0.82 * settings.windSpeed) * 0.18,
        settings.windBase
          + Math.sin(time * 1.8 * settings.windSpeed) * settings.windGust
          + Math.sin(time * 5.1 * settings.windSpeed) * settings.flutter,
      ],
      damping: settings.damping,
      stiffness: settings.stiffness,
      shearStiffness: settings.shearStiffness,
      bendStiffness: settings.bendStiffness,
      substeps: settings.substeps,
      iterations: settings.iterations,
      pins: settings.pins,
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
    camera: { position: [0, 0.02, 4.2], target: [0, -0.03, 0], fov: settings.cameraFov },
    material: {
      roughness: settings.roughness,
      metalness: settings.metalness,
      iridescence: settings.iridescence,
      iridescenceIOR: 1.42,
      iridescenceThicknessRange: [120, 520],
      clearcoat: settings.clearcoat,
      clearcoatRoughness: settings.clearcoatRoughness,
      sheen: settings.sheen,
      sheenRoughness: 0.34,
      sheenColor: 0xc8f7ff,
      emissive: 0x111408,
      emissiveIntensity: 0.1,
      transparent: true,
    },
    ambientLight: { color: 0xeaf6dc, intensity: 1.2 },
    directionalLight: { color: 0xfff1cf, intensity: 2.8, position: [-2.7, 3.8, 4.5] },
    clearAlpha: 0,
  };
}

function applyArt(root: HTMLElement, document: KineticClothDocument): void {
  root.style.setProperty("--acid", document.art.accent);
  root.style.setProperty("--orange", document.art.secondary);
  root.dataset.grid = String(document.art.showGrid);
}

/** JSON changes reconfigure this comp's solver in place without rebuilding the project. */
export const kineticPosterClothSetup: CompositionSetup = async (context) => {
  let revision = 0;
  let disposed = false;
  let activeCleanups: Array<() => void> = [];
  let reconfiguration = Promise.resolve();
  const dispose = (cleanups: Array<() => void>) => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
  };
  const configure = (value: unknown): Promise<void> => {
    const document = (value ?? fallbackDocument) as KineticClothDocument;
    const currentRevision = ++revision;
    reconfiguration = reconfiguration.catch(() => {}).then(async () => {
      if (disposed || currentRevision !== revision) return;
      dispose(activeCleanups);
      activeCleanups = [];
      applyArt(context.root, document);
      const nextCleanups: Array<() => void> = [];
      try {
        await createClothSetup(optionsFor(document))({
          ...context,
          document,
          onCleanup: (cleanup) => nextCleanups.push(cleanup),
        });
      } catch (error) {
        dispose(nextCleanups);
        const message = error instanceof Error ? error.message : String(error);
        context.root.dataset.fdError = message;
        const errorElement = context.root.querySelector<HTMLElement>(".runtime-error");
        if (errorElement) errorElement.textContent = `Cloth preview failed. ${message}`;
        throw error;
      }
      if (disposed || currentRevision !== revision) dispose(nextCleanups);
      else {
        delete context.root.dataset.fdError;
        const errorElement = context.root.querySelector<HTMLElement>(".runtime-error");
        if (errorElement) errorElement.textContent = "";
        activeCleanups = nextCleanups;
      }
    });
    return reconfiguration;
  };

  await configure(context.document);
  const stopDocument = context.onDocument(configure);
  context.onCleanup(() => {
    disposed = true;
    revision += 1;
    stopDocument();
    dispose(activeCleanups);
    activeCleanups = [];
  });
};
