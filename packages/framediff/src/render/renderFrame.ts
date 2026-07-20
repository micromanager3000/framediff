// Render a single framework-free composition frame to a 2D canvas.

import { toCanvas } from "../vendor/html-to-image";
import { mountComposition } from "../runtime";
import type { CompositionConfig, CompositionRegistry } from "../composition";
import type { AssetResolver } from "../assets/resolver";

export interface RenderFrameOptions {
  /** Output width in px (height follows the composition's aspect). Defaults to the composition width. */
  width?: number;
  resolver?: AssetResolver;
  registry?: CompositionRegistry;
}

/**
 * DOM-only capture for deterministic HTML/CSS compositions. Use `captureCompositeFrame` when a
 * composition contains decoded video or a WebGPU/WebGL canvas.
 */
export async function renderFrameToCanvas(
  composition: CompositionConfig,
  frame: number,
  opts: RenderFrameOptions = {},
): Promise<HTMLCanvasElement> {
  const pixelRatio = (opts.width ?? composition.width) / composition.width;
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-99999px;top:0;";
  const host = document.createElement("div");
  host.style.cssText = `position:relative;width:${composition.width}px;height:${composition.height}px;overflow:hidden;`;
  wrapper.appendChild(host);
  document.body.appendChild(wrapper);
  const handle = mountComposition(host, composition, {
    frame,
    resolver: opts.resolver,
    registry: opts.registry,
  });
  try {
    await handle.ready;
    handle.update({ frame, playing: false });
    await document.fonts?.ready;
    return await toCanvas(host, { pixelRatio, cacheBust: false });
  } finally {
    handle.destroy();
    wrapper.remove();
  }
}
