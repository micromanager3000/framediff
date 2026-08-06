import {
  combineCompositionSetups,
  defineComposition,
  type CompositionConfig,
  type CompositionMetadata,
  type CompositionSetup,
} from "../composition";
import type { GradeParams } from "../effects/grade";
import { gradeDataAttributes } from "../effects/gradeAttributes";
import {
  createVideoPlane3DSetup,
  type VideoPlane3DSetupOptions,
} from "../effects/htmlVideoEffects";
import { escapeHtml, htmlAttributes, kebabCase } from "./html";

export interface VideoPlane3DCompositionOptions {
  id: string;
  src: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  name?: string;
  clipId?: string;
  trimStart?: number;
  playbackRate?: number;
  background?: string;
  grade?: GradeParams;
  lutIntensity?: number;
  lutName?: string;
  /** Additional authored `data-fd-*` attributes for project-specific Inspector metadata. */
  canvasAttributes?: Record<string, string | number | boolean | null | undefined>;
  /** Renderer/camera parameters shared with `createVideoPlane3DSetup`. */
  effect?: VideoPlane3DSetupOptions;
  /** Project setup that must run before the renderer attaches, e.g. loading a custom LUT. */
  setup?: CompositionSetup;
  /** JSON-backed settings consumed by setup/effect construction. */
  document?: unknown;
  meta?: CompositionMetadata;
}

/**
 * Define a self-contained, nestable shot that textures one video onto an animated 3D plane.
 * The renderer remains an effect; this helper supplies the composition boundary useful for a
 * shot with its own camera clock, source trim, and independently editable/bakeable output.
 */
export function defineVideoPlane3DComposition(options: VideoPlane3DCompositionOptions): CompositionConfig {
  const clipId = options.clipId ?? `plane-${kebabCase(options.name ?? options.id)}`;
  const effect = options.effect ?? {};
  const canvasAttributes = htmlAttributes({
    "data-fd-clip": true,
    "data-fd-id": clipId,
    "data-fd-name": options.name ?? options.id,
    "data-fd-from": 0,
    "data-fd-duration": options.durationInFrames,
    "data-fd-video-plane-3d": true,
    "data-fd-src": options.src,
    "data-fd-trim-start": options.trimStart ?? 0,
    "data-fd-playback-rate": options.playbackRate ?? 1,
    "data-fd-prop-max-blur": effect.maxBlur,
    "data-fd-lut-intensity": options.lutIntensity,
    "data-fd-lut-name": options.lutName,
    ...gradeDataAttributes(options.grade),
    ...options.canvasAttributes,
  });
  const rootAttributes = htmlAttributes({
    "data-fd-composition": true,
    "data-fd-id": options.id,
    "data-fd-width": options.width,
    "data-fd-height": options.height,
    "data-fd-fps": options.fps,
    "data-fd-duration": options.durationInFrames,
    "data-fd-kind": "scene",
    "data-fd-library": options.meta?.library ?? true,
    "data-fd-alpha": options.meta?.alpha,
  });
  const background = escapeHtml(options.background ?? "#000");
  const source = `<!doctype html><html><head><style>[data-fd-composition],canvas{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:${background}}</style></head><body><main ${rootAttributes}><canvas ${canvasAttributes}></canvas></main></body></html>`;
  return defineComposition(source, {
    id: options.id,
    type: "three",
    document: options.document,
    setup: combineCompositionSetups(options.setup, createVideoPlane3DSetup(effect)),
    meta: { ...options.meta, sourceFormat: "generated", library: options.meta?.library ?? true },
  });
}
