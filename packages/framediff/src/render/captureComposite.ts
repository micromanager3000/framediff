// Bake a single composited frame to a canvas — the exact same per-frame pipeline the exporter runs
// (deterministic WebCodecs video decode, WebGPU effect readback, DOM raster at output resolution),
// minus the worker/audio/encode. Useful for poster frames, thumbnails, and frame-by-frame audits
// where you want the TRUE baked output (not a live preview screenshot) at an arbitrary frame.

import { toCanvas, getFontEmbedCSS } from "../vendor/html-to-image";
import { preloadAssetResolver, type AssetResolver } from "../assets/resolver";
import { VideoFrameSource } from "./videoFrames";
import { bgDelay } from "./bgTimer";
import { bakeGradeLayers } from "./gradeLayerPass";
import { insertStandIn, settleStandIn } from "./standIn";
import { waitForWebGpuCapture } from "./webgpuCapture";
import { isVisualElementActive } from "./activeElement";
import { videoFrameSource } from "./videoSource";
import type { CompositionConfig, CompositionOutputKind, CompositionRegistry } from "../composition";
import { mountComposition } from "../runtime";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : e == null ? "" : String(e));

export interface CaptureFrameOptions {
  width: number;
  height: number;
  resolver?: AssetResolver;
  registry?: CompositionRegistry;
  resolveCompositionOutput?: (compositionRef: string, outputKind: CompositionOutputKind) => Promise<string>;
}

/** Render `comp` at `frame` and return the composited frame as a canvas at the requested resolution. */
export async function captureCompositeFrame(comp: CompositionConfig, frame: number, opts: CaptureFrameOptions): Promise<HTMLCanvasElement> {
  const { width: outW, height: outH, resolver, registry, resolveCompositionOutput } = opts;
  const { width: cw, height: ch } = comp;
  const pixelRatio = outW / cw;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-99999px;top:0;";
  const host = document.createElement("div");
  host.style.cssText = `position:relative;width:${cw}px;height:${ch}px;overflow:hidden;`;
  wrapper.appendChild(host);
  document.body.appendChild(wrapper);
  const handle = mountComposition(host, comp, {
    resolver,
    registry,
    resolveCompositionOutput,
    frame,
    playing: false,
  });
  const renderSync = (n: number) => handle.update({ frame: n, playing: false });
  const frameSource = new VideoFrameSource();
  const captureFlag = window as unknown as { __FRAMEDIFF_CAPTURE_MODE__?: boolean };
  const previousCaptureMode = captureFlag.__FRAMEDIFF_CAPTURE_MODE__;
  captureFlag.__FRAMEDIFF_CAPTURE_MODE__ = true;

  try {
    await preloadAssetResolver(resolver);
    await handle.ready;
    renderSync(frame);
    await document.fonts?.ready;
    let fontEmbedCSS = "";
    try { fontEmbedCSS = await getFontEmbedCSS(host); } catch { /* fonts optional */ }

    // give async video/WebGPU init a moment, then re-render at the target frame
    await bgDelay(250);
    renderSync(frame);

    const temps: HTMLImageElement[] = [];
    for (const v of Array.from(host.querySelectorAll<HTMLVideoElement>("video[data-framediff-video]")).filter((element) => isVisualElementActive(element, host))) {
      const src = videoFrameSource(v);
      if (!src) continue;
      const t = parseFloat(v.dataset.framediffTime || "0");
      let url: string | null = null;
      let decodeErr: unknown;
      try { url = await frameSource.frameDataURL(src, t); } catch (err) { decodeErr = err; url = null; }
      if (!url) {
        const detail = errorMessage(decodeErr ?? frameSource.lastError(src));
        throw new Error(`Video frame decode failed at frame ${frame}: ${src} @ ${t.toFixed(3)}s${detail ? ` (${detail})` : ""}`);
      }
      temps.push(insertStandIn(v, host, url, "cover"));
    }

    for (const cv of Array.from(host.querySelectorAll<HTMLCanvasElement>("canvas[data-framediff-webgpu]")).filter((element) => isVisualElementActive(element, host))) {
      const t = parseFloat(cv.dataset.framediffTime || "0");
      const holder = cv as unknown as { __framediffCapture?: (t: number) => Promise<HTMLCanvasElement> };
      const cap = await waitForWebGpuCapture(holder, { label: `frame ${frame}` });
      let url: string;
      try {
        url = (await cap(t)).toDataURL("image/png");
      } catch (err) {
        throw new Error(`WebGPU layer capture failed at frame ${frame}: ${err instanceof Error ? err.message : String(err)}`);
      }
      temps.push(insertStandIn(cv, host, url, "contain"));
    }

    await Promise.all(temps.map((img) => settleStandIn(img)));

    // Floating grade layers: pre-compose what paints beneath each one and bake its
    // backdrop-filter via canvas 2d (see gradeLayerPass.ts).
    const cleanupGradeLayers = await bakeGradeLayers(host, {
      pixelRatio,
      fontEmbedCSS,
      baseFilter: (node) =>
        !(node instanceof HTMLVideoElement) &&
        !(node instanceof HTMLCanvasElement && node.hasAttribute("data-framediff-webgpu")),
    });

    const canvas = await toCanvas(host, {
      pixelRatio,
      fontEmbedCSS,
      cacheBust: false,
      filter: (node) =>
        !(node instanceof HTMLVideoElement) &&
        !(node instanceof HTMLCanvasElement && node.hasAttribute("data-framediff-webgpu")),
    });
    temps.forEach((t) => t.remove());
    cleanupGradeLayers();
    void outH;
    return canvas;
  } finally {
    captureFlag.__FRAMEDIFF_CAPTURE_MODE__ = previousCaptureMode;
    handle.destroy();
    wrapper.remove();
    VideoFrameSource.clearBlobCache();
  }
}
