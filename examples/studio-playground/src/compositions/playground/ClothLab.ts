import {
  createClothSetup,
  defineComposition,
  type ClothSetupOptions,
  type CompositionSetup,
} from "framediff";
import source from "./ClothLab.html?raw";
import clothDocument from "./ClothLab.comp.json";

interface ClothLabDocument {
  simulation: {
    gravityY: number;
    windBase: number;
    windGust: number;
    damping: number;
    stiffness: number;
    bendStiffness: number;
    pins: "none" | "top" | "corners";
  };
  material: { roughness: number; metalness: number };
  art: { accent: string; title: string; showGrid: boolean };
}

const initialDocument = clothDocument as ClothLabDocument;

function clothOptions(document: ClothLabDocument): ClothSetupOptions {
  return {
    textureRefresh: "frame",
    texturePixelRatio: 1,
    hideSource: true,
    simulation: {
    width: 3.6,
    height: 2.02,
    segmentsX: 22,
    segmentsY: 14,
    mass: 0.9,
    gravity: [0, document.simulation.gravityY, 0],
    wind: (time) => [
      Math.sin(time * 1.4) * document.simulation.windBase * 0.375,
      Math.cos(time * 0.8) * 0.16,
      document.simulation.windBase + Math.sin(time * 2.1) * document.simulation.windGust,
    ],
    damping: document.simulation.damping,
    stiffness: document.simulation.stiffness,
    shearStiffness: 0.8,
    bendStiffness: document.simulation.bendStiffness,
    substeps: 3,
    iterations: 6,
    pins: document.simulation.pins,
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
    material: {
      roughness: document.material.roughness,
      metalness: document.material.metalness,
      emissive: 0x101408,
      emissiveIntensity: 0.1,
      transparent: true,
    },
    ambientLight: { color: 0xeaf6dc, intensity: 1.15 },
    directionalLight: { color: 0xfff0d0, intensity: 2.7, position: [-2.8, 3.8, 4.4] },
    clearAlpha: 0,
  };
}

function applyArt(root: HTMLElement, document: ClothLabDocument): void {
  root.style.setProperty("--cloth-accent", document.art.accent);
  root.querySelector<HTMLElement>(".cloth-source")?.setAttribute("data-grid", String(document.art.showGrid));
  const title = root.querySelector<HTMLElement>(".cloth-title span:last-child");
  if (title) title.textContent = document.art.title;
}

/** Rebuild only this comp's procedural solver when its JSON document changes. */
const clothSetup: CompositionSetup = async (context) => {
  let revision = 0;
  let activeCleanups: Array<() => void> = [];
  const dispose = (cleanups: Array<() => void>) => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
  };
  const configure = async (value: unknown) => {
    const document = (value ?? initialDocument) as ClothLabDocument;
    const currentRevision = ++revision;
    dispose(activeCleanups);
    activeCleanups = [];
    applyArt(context.root, document);
    const nextCleanups: Array<() => void> = [];
    await createClothSetup(clothOptions(document))({
      ...context,
      document,
      onCleanup: (cleanup) => nextCleanups.push(cleanup),
    });
    if (currentRevision === revision) activeCleanups = nextCleanups;
    else dispose(nextCleanups);
  };

  await configure(context.document);
  const stopDocument = context.onDocument(configure);
  context.onCleanup(() => {
    revision += 1;
    stopDocument();
    dispose(activeCleanups);
    activeCleanups = [];
  });
};

export const clothLabComp = defineComposition(source, {
  setup: clothSetup,
  document: initialDocument,
  meta: {
    deps: ["src/compositions/playground/ClothLab.ts"],
    authoring: { timeline: "hidden", directManipulation: true },
    document: {
      file: "src/compositions/playground/ClothLab.comp.json",
      schema: "src/compositions/playground/ClothLab.schema.json",
      bindings: {
        "cloth-scene": "/simulation",
        "cloth-surface": "/material",
        "cloth-source-art": "/art",
      },
    },
  },
});
