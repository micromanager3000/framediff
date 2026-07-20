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

export interface ThreeSceneCompositionOptions {
  scene: ThreeSceneDef;
  id?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  cameras?: ThreeSceneCameraCut[];
  defaultCamera?: string;
  background?: string;
  setup?: CompositionSetup;
  meta?: CompositionMetadata;
}

/** Define a nestable three.js scene composition without repeating canvas/camera-cut boilerplate. */
export function defineThreeSceneComposition(options: ThreeSceneCompositionOptions): CompositionConfig {
  const id = options.id ?? options.scene.id;
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
  return defineComposition(source, {
    id,
    setup: combineCompositionSetups(options.setup, createThreeSceneSetup({
      scene: options.scene,
      camera: options.defaultCamera,
    })),
    meta: { ...options.meta, kind: "3d", sourceFormat: "generated", library: options.meta?.library ?? true },
  });
}
