import {
  combineCompositionSetups,
  defineComposition,
  type CompositionConfig,
  type CompositionMetadata,
  type CompositionSetup,
} from "../composition";
import { escapeHtml, htmlAttributes, kebabCase } from "../compositions/html";
import { createThreeSceneSetup } from "./runtime";
import type { ThreeSceneDef } from "./sceneDef";

export interface ThreeSceneCameraCut {
  camera: string;
  from: number;
  durationInFrames: number;
  id?: string;
  name?: string;
}

/** A three-scene comp carries its scene so other comps can reference the COMP itself. */
export type ThreeSceneComp = CompositionConfig & { threeScene: ThreeSceneDef; threeSceneCompId: string };

export interface ThreeSceneCompositionOptions {
  /** The scene to shoot: a raw defineThreeScene recipe, or ANOTHER three-scene comp
   *  (e.g. the project's Set comp) — the reference is recorded on the root as
   *  data-fd-scene-comp and in meta.deps, like comp:// refs on generative recipes. */
  scene: ThreeSceneDef | ThreeSceneComp;
  id?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  cameras?: ThreeSceneCameraCut[];
  defaultCamera?: string;
  /** Project-relative JSON for hand-flown camera keyframes (enables the Camera Lab). */
  cameraFile?: string;
  background?: string;
  setup?: CompositionSetup;
  meta?: CompositionMetadata;
}

/** Define a nestable three.js scene composition without repeating canvas/camera-cut boilerplate. */
export function defineThreeSceneComposition(options: ThreeSceneCompositionOptions): ThreeSceneComp {
  const sourceComp = "threeScene" in options.scene ? (options.scene as ThreeSceneComp) : undefined;
  const scene = sourceComp ? sourceComp.threeScene : (options.scene as ThreeSceneDef);
  const id = options.id ?? scene.id;
  const rootAttributes = htmlAttributes({
    "data-fd-composition": true,
    "data-fd-id": id,
    "data-fd-width": options.width,
    "data-fd-height": options.height,
    "data-fd-fps": options.fps,
    "data-fd-duration": options.durationInFrames,
    "data-fd-kind": "3d",
    "data-fd-library": options.meta?.library ?? true,
    "data-fd-alpha": options.meta?.alpha,
    "data-fd-scene-comp": sourceComp?.threeSceneCompId,
    "data-fd-interactive": options.cameraFile ? true : undefined,
    "data-fd-camera-file": options.cameraFile,
  });
  const cameraCuts = (options.cameras ?? []).map((cut, index) => `<i ${htmlAttributes({
    "data-fd-clip": true,
    "data-fd-id": cut.id ?? `camera-${kebabCase(cut.camera)}-${index + 1}`,
    "data-fd-name": cut.name ?? cut.camera,
    "data-fd-from": cut.from,
    "data-fd-duration": cut.durationInFrames,
    "data-fd-type": "camera",
    "data-fd-camera": cut.camera,
  })}></i>`).join("");
  const background = escapeHtml(options.background ?? "#000");
  const source = `<!doctype html><html><head><style>[data-fd-composition]{position:relative;overflow:hidden;background:${background}}canvas{position:absolute;inset:0;width:100%;height:100%}[data-fd-camera]{display:none}</style></head><body><main ${rootAttributes}><canvas data-fd-three data-fd-webgpu></canvas>${cameraCuts}</main></body></html>`;
  const deps = [
    ...(options.meta?.deps ?? []),
    ...(sourceComp?.meta?.file ? [sourceComp.meta.file] : []),
    ...(options.cameraFile ? [options.cameraFile] : []),
  ];
  const config = defineComposition(source, {
    id,
    setup: combineCompositionSetups(options.setup, createThreeSceneSetup({
      scene,
      camera: options.defaultCamera,
      cameraFile: options.cameraFile,
    })),
    meta: {
      ...options.meta,
      kind: "3d",
      sourceFormat: "generated",
      library: options.meta?.library ?? true,
      ...(deps.length ? { deps } : {}),
    },
  }) as ThreeSceneComp;
  config.threeScene = scene;
  config.threeSceneCompId = id;
  return config;
}
