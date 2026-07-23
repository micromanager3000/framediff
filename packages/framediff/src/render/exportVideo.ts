// Render a composition to MP4 at a chosen resolution, compositing video layers under the
// DOM and mixing audio in.
//
// Main thread (has the DOM): render each frame off-screen, seek + capture each <video> as an
// ImageBitmap, and rasterize the DOM (excluding <video>) at the OUTPUT resolution. A pre-pass
// reconstructs the audio schedule from the <audio> elements and mixes it offline.
// Worker (encodeWorker.ts): composite video-under-DOM, encode video + audio, mux to MP4.

import { toCanvas, getFontEmbedCSS } from "../vendor/html-to-image";
import { preloadAssetResolver, type AssetResolver } from "../assets/resolver";
import { VideoFrameSource } from "./videoFrames";
import { bakeGradeLayers } from "./gradeLayerPass";
import { insertStandIn, settleStandIn } from "./standIn";
import { waitForWebGpuCapture } from "./webgpuCapture";
import { isAudioElementActive, isVisualElementActive } from "./activeElement";
import { videoFrameSource } from "./videoSource";
import { createAppendWritableSink, createFileSystemWritableSink, type ExportChunkSink } from "./exportSinks";
import type { CompositionConfig, CompositionRegistry } from "../composition";
import { mountComposition } from "../runtime";

const SAMPLE_RATE = 48000;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : e == null ? "" : String(e));
type StreamFastStart = false | "fragmented";

export type ExportPhase = "prepare" | "audio" | "render" | "finalize";

export interface ExportProgress {
  phase: ExportPhase;
  /** Frames composited on the main thread and handed to the encode worker. */
  framesRendered: number;
  /** Frames the encode worker has consumed (trails framesRendered by the encoder queue). */
  framesEncoded: number;
  totalFrames: number;
  /** Frames scanned by the audio pre-pass (counts up during the "audio" phase). */
  audioFramesScanned: number;
  /** Bytes flushed to the output sink so far (stream outputs only). */
  bytesWritten?: number;
}

export interface ExportOptions {
  width: number;
  height: number;
  codec: string;
  muxerCodec: "avc" | "av1";
  bitrate: number;
  /** Defaults to "prefer-hardware"; use "prefer-software" only when codec byte determinism matters. */
  hardwareAcceleration?: "no-preference" | "prefer-hardware" | "prefer-software";
  /** resolve `assetId`/`asset://` media to bytes during export (P1) — keeps preview = render. */
  resolver?: AssetResolver;
  /** Registry used to resolve `data-fd-comp` nested compositions. */
  registry?: CompositionRegistry;
  /** render only [startFrame, endFrame) — a window of the composition (timestamps restart at 0). */
  startFrame?: number;
  endFrame?: number;
  /** Frames outside this range encode as black — where the timeline has nothing, the picture
   *  is nothing. Defaults to the comp's own domain [0, durationInFrames). */
  contentDomain?: { from: number; to: number };
  /** Cancels the export: the loop stops at the next frame boundary and the sink is aborted. */
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

export interface ExportVideoSinkOptions extends ExportOptions {
  /** Positioned writes let stream targets patch MP4 headers without buffering the whole file. */
  sink: ExportChunkSink;
  /** Defaults to false: a normal MP4 with metadata at the end, written incrementally by byte offset. */
  streamFastStart?: StreamFastStart;
}

export interface ExportVideoWritableOptions extends ExportOptions {
  /** Append-only writable stream. Uses fragmented MP4 so chunks are written monotonically. */
  writable: WritableStream<Uint8Array>;
}

export interface ExportVideoFileSystemOptions extends ExportOptions {
  /** Chrome File System Access writable. Uses positioned writes for a normal MP4 without whole-file buffering. */
  writable: FileSystemWritableFileStream;
}

export interface ExportVideoStreamResult {
  bytesWritten: number;
  fastStart: StreamFastStart;
}

interface AudioClip { src: string; startFrame: number; endFrame: number; trimStart: number; volume: number }

/** Group per-frame audio samples into playable clips. A run breaks on a gap in frames OR a volume
 *  change — so a per-frame `volume={(f)=>…}` fade becomes per-frame gain steps (Remotion's
 *  evaluation model), each step continuing seamlessly from the same source time. Exported for tests. */
export function buildAudioClips(samples: { n: number; src: string; time: number; volume: number }[]): AudioClip[] {
  const bySrc = new Map<string, { n: number; time: number; volume: number }[]>();
  for (const s of samples) {
    // Negative trim is visual/audio pre-roll. Audio stays silent until its source reaches t0.
    if (s.time < 0) continue;
    if (!bySrc.has(s.src)) bySrc.set(s.src, []);
    bySrc.get(s.src)!.push(s);
  }
  const clips: AudioClip[] = [];
  for (const [src, arr] of bySrc) {
    arr.sort((a, b) => a.n - b.n);
    let run: { firstN: number; lastN: number; trimStart: number; volume: number } | null = null;
    const flush = () => {
      if (run) clips.push({ src, startFrame: run.firstN, endFrame: run.lastN + 1, trimStart: run.trimStart, volume: run.volume });
    };
    for (const s of arr) {
      if (run && s.n === run.lastN + 1 && s.volume === run.volume) run.lastN = s.n;
      else {
        flush();
        run = { firstN: s.n, lastN: s.n, trimStart: s.time, volume: s.volume };
      }
    }
    flush();
  }
  return clips;
}

async function mixAudio(clips: AudioClip[], durationSec: number, fps: number): Promise<AudioBuffer | null> {
  if (!clips.length) return null;
  const octx = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationSec * SAMPLE_RATE)), SAMPLE_RATE);
  for (const c of clips) {
    try {
      const arr = await fetch(c.src).then((r) => r.arrayBuffer());
      const buf = await octx.decodeAudioData(arr);
      const node = octx.createBufferSource();
      node.buffer = buf;
      const gain = octx.createGain();
      gain.gain.value = c.volume;
      node.connect(gain).connect(octx.destination);
      node.start(c.startFrame / fps, c.trimStart, (c.endFrame - c.startFrame) / fps);
    } catch {
      /* skip undecodable audio */
    }
  }
  return octx.startRendering();
}

type ExportOutput = { kind: "buffer" } | { kind: "stream"; sink: ExportChunkSink; fastStart: StreamFastStart };

async function exportVideoInternal(
  comp: CompositionConfig,
  opts: ExportOptions,
  output: ExportOutput,
): Promise<ArrayBuffer | ExportVideoStreamResult> {
  const { width: outW, height: outH, codec, muxerCodec, bitrate, hardwareAcceleration, resolver, registry, onProgress, signal } = opts;
  const { width: cw, height: ch, fps } = comp;
  // The window may start before frame 0 (pre-roll: sequences not yet begun render as
  // empty) or end past durationInFrames — the output timeline always restarts at 0.
  const startFrame = Math.round(opts.startFrame ?? 0);
  const endFrame = Math.max(startFrame + 1, Math.round(opts.endFrame ?? comp.durationInFrames));
  const totalFrames = endFrame - startFrame;
  const pixelRatio = outW / cw;

  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new DOMException("export aborted", "AbortError");
  };
  throwIfAborted();

  let phase: ExportPhase = "prepare";
  let framesRendered = 0;
  let framesEncoded = 0;
  let audioFramesScanned = 0;
  let bytesWritten = 0;
  const emitProgress = () =>
    onProgress?.({
      phase,
      framesRendered,
      framesEncoded,
      totalFrames,
      audioFramesScanned,
      ...(output.kind === "stream" ? { bytesWritten } : {}),
    });

  // Holding a Web Lock exempts the page from background tab freezing (Chrome's Memory/Energy
  // Saver would otherwise suspend a hidden tab mid-export); released in the outer finally.
  let lockReleased = false;
  let releaseLock = () => {
    lockReleased = true;
  };
  void navigator.locks
    ?.request("framediff-export", { mode: "shared" }, () => new Promise<void>((resolve) => (lockReleased ? resolve() : (releaseLock = resolve))))
    .catch(() => {});
  const onFreeze = () =>
    console.warn("framediff: the browser froze this page mid-export — rendering stalls until the page resumes");
  document.addEventListener("freeze", onFreeze);

  // off-screen wrapper holds the cleanly-positioned host we capture
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;left:-99999px;top:0;";
  const host = document.createElement("div");
  host.style.cssText = `position:relative;width:${cw}px;height:${ch}px;overflow:hidden;`;
  wrapper.appendChild(host);
  document.body.appendChild(wrapper);
  const contentDomain = opts.contentDomain ?? { from: 0, to: comp.durationInFrames };
  const handle = mountComposition(host, comp, { resolver, registry, frame: 0, playing: false, contentDomain });
  const renderSync = (n: number) => handle.update({ frame: n, playing: false });
  const frameSource = new VideoFrameSource();
  const captureFlag = window as unknown as { __FRAMEDIFF_CAPTURE_MODE__?: boolean };
  const previousCaptureMode = captureFlag.__FRAMEDIFF_CAPTURE_MODE__;
  captureFlag.__FRAMEDIFF_CAPTURE_MODE__ = true;

  try {
    emitProgress();
    await preloadAssetResolver(resolver);
    await handle.ready;
    throwIfAborted();
    renderSync(0);
    await document.fonts?.ready;
    let fontEmbedCSS = "";
    try {
      fontEmbedCSS = await getFontEmbedCSS(host);
    } catch {
      /* fonts optional */
    }

    // --- pass 1: reconstruct the audio schedule (cheap; no rasterization) ---
    phase = "audio";
    const samples: { n: number; src: string; time: number; volume: number }[] = [];
    for (let n = startFrame; n < endFrame; n++) {
      throwIfAborted();
      renderSync(n);
      host.querySelectorAll<HTMLElement>("audio[data-framediff-audio]").forEach((a) => {
        if (!isAudioElementActive(a, host)) return;
        const volume = parseFloat(a.dataset.framediffVolume || "1");
        if (!(volume > 0)) return;
        samples.push({
          n: n - startFrame, // clip-local frame — the exported window's timeline starts at 0
          src: a.getAttribute("src") || "",
          time: parseFloat(a.dataset.framediffTime || "0"),
          volume,
        });
      });
      host.querySelectorAll<HTMLVideoElement>("video[data-framediff-video]").forEach((video) => {
        if (!isAudioElementActive(video, host)) return;
        const volume = parseFloat(video.dataset.framediffVolume || "1");
        const src = videoFrameSource(video);
        if (!(volume > 0) || !src) return;
        samples.push({
          n: n - startFrame,
          src,
          time: parseFloat(video.dataset.framediffTime || "0"),
          volume,
        });
      });
      audioFramesScanned = n - startFrame + 1;
      emitProgress();
    }
    const mixed = await mixAudio(buildAudioClips(samples), totalFrames / fps, fps);
    throwIfAborted();

    // --- worker ---
    const worker = new Worker(new URL("./encodeWorker.ts", import.meta.url), { type: "module" });
    let inflight = 0;
    let fatalError: unknown = null;
    // Backpressure is event-driven: worker "encoded" acks wake the frame loop. A setTimeout
    // poll here would be clamped to 1s (then 1/minute) ticks while the window is hidden.
    let wakeLoop = () => {};
    const waitForLoopWake = () =>
      new Promise<void>((resolve) => {
        wakeLoop = resolve;
      });
    const onAbort = () => wakeLoop();
    signal?.addEventListener("abort", onAbort);
    let sinkChain = Promise.resolve();
    let sinkError: unknown = null;
    let sinkClosed = false;
    const done = new Promise<ArrayBuffer | ExportVideoStreamResult>((resolve, reject) => {
      worker.addEventListener("message", (e: MessageEvent) => {
        const m = e.data;
        if (m?.type === "encoded") {
          inflight--;
          framesEncoded = Math.max(framesEncoded, (m.n as number) + 1);
          emitProgress();
          wakeLoop();
        } else if (m?.type === "chunk" && output.kind === "stream") {
          const data = new Uint8Array(m.data as ArrayBuffer);
          sinkChain = sinkChain
            .then(async () => {
              if (sinkError) throw sinkError;
              await output.sink.write(data, m.position);
              bytesWritten = Math.max(bytesWritten, m.position + data.byteLength);
              worker.postMessage({ type: "stream-ack", id: m.id, ok: true });
              if (phase === "finalize") emitProgress();
            })
            .catch((err) => {
              sinkError = sinkError ?? err;
              worker.postMessage({ type: "stream-ack", id: m.id, ok: false, message: errorMessage(sinkError) });
              throw sinkError;
            });
          void sinkChain.catch(() => {});
        } else if (m?.type === "done") {
          if (output.kind === "stream") {
            sinkChain
              .then(async () => {
                if (sinkError) throw sinkError;
                await output.sink.close?.();
                sinkClosed = true;
                resolve({ bytesWritten: m.bytesWritten ?? 0, fastStart: output.fastStart });
              })
              .catch(async (err) => {
                await Promise.resolve(output.sink.abort?.(err)).catch(() => {});
                sinkClosed = true;
                reject(err instanceof Error ? err : new Error(String(err)));
              });
          } else {
            resolve(m.buffer as ArrayBuffer);
          }
        } else if (m?.type === "error") {
          const err = new Error(m.message);
          fatalError = fatalError ?? err;
          wakeLoop();
          if (output.kind === "stream" && !sinkClosed) {
            void Promise.resolve(output.sink.abort?.(err)).catch(() => {});
            sinkClosed = true;
          }
          reject(err);
        }
      });
      // A worker that fails to LOAD (404/403 on the module, syntax error) never posts a
      // message at all — without this listener the export hangs forever awaiting "ready".
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        const detail = (event as ErrorEvent).message;
        const err = new Error(
          detail
            ? `encode worker error: ${detail}`
            : "encode worker failed to start — reload the page; if it persists, ensure framediffDev() is enabled in Vite",
        );
        fatalError = fatalError ?? err;
        wakeLoop();
        if (output.kind === "stream" && !sinkClosed) {
          void Promise.resolve(output.sink.abort?.(err)).catch(() => {});
          sinkClosed = true;
        }
        reject(err);
      });
    });
    // the frame loop may throw (abort, worker error) before `done` is awaited — keep its
    // rejection handled so cancellation doesn't surface as an unhandled-rejection warning
    void done.catch(() => {});
    const ready = new Promise<void>((res) => {
      const h = (e: MessageEvent) => {
        if (e.data?.type === "ready") {
          worker.removeEventListener("message", h);
          res();
        }
      };
      worker.addEventListener("message", h);
    });
    worker.postMessage({
      type: "init",
      width: outW,
      height: outH,
      fps,
      codec,
      muxerCodec,
      bitrate,
      hardwareAcceleration: hardwareAcceleration ?? "prefer-hardware",
      audio: mixed ? { sampleRate: SAMPLE_RATE, numberOfChannels: 2 } : null,
      output:
        output.kind === "stream"
          ? { mode: "stream", fastStart: output.fastStart }
          : { mode: "buffer" },
    });
    // done settles first only when the worker errors before init completes
    await Promise.race([ready, done]);
    phase = "render";
    emitProgress();

    try {
      // --- pass 2: render + capture each frame ---
      for (let n = startFrame; n < endFrame; n++) {
        if (fatalError) throw fatalError;
        throwIfAborted();
        renderSync(n);
        const videos = Array.from(host.querySelectorAll<HTMLVideoElement>("video[data-framediff-video]"))
          .filter((element) => isVisualElementActive(element, host));

        // For each video, get the EXACT source frame at its time via deterministic WebCodecs
        // decode (MediaBunny). Bake it into a temp <img> over the <video> so html-to-image captures the whole
        // composition in correct z-order (bg under, overlays above, rounded corners clipped).
        const temps: HTMLImageElement[] = [];
        for (const v of videos) {
          const src = videoFrameSource(v);
          if (!src) continue;
          const t = parseFloat(v.dataset.framediffTime || "0");
          let url: string | null = null;
          let decodeErr: unknown;
          try {
            url = await frameSource.frameDataURL(src, t);
          } catch (err) {
            decodeErr = err;
            url = null;
          }
          if (!url) {
            const detail = errorMessage(decodeErr ?? frameSource.lastError(src));
            throw new Error(`Video frame decode failed at frame ${n}: ${src} @ ${t.toFixed(3)}s${detail ? ` (${detail})` : ""}`);
          }
          temps.push(insertStandIn(v, host, url, "cover"));
        }

        // WebGPU canvases: read back the exact frame (swap-chain isn't drawImage-readable) and
        // bake it as a transparent PNG so it composites in correct z-order. Wait for async init.
        // Runs before the backdrop passes below so glass/grade layers sample the real content.
        for (const cv of Array.from(host.querySelectorAll<HTMLCanvasElement>("canvas[data-framediff-webgpu]")).filter((element) => isVisualElementActive(element, host))) {
          const t = parseFloat(cv.dataset.framediffTime || "0");
          const holder = cv as unknown as { __framediffCapture?: (t: number) => Promise<HTMLCanvasElement> };
          const cap = await waitForWebGpuCapture(holder, { label: `frame ${n}` });
          let url: string;
          try {
            url = (await cap(t)).toDataURL("image/png");
          } catch (err) {
            throw new Error(`WebGPU layer capture failed at frame ${n}: ${err instanceof Error ? err.message : String(err)}`);
          }
          temps.push(insertStandIn(cv, host, url, "contain"));
        }
        await Promise.all(temps.map((t) => (t instanceof HTMLImageElement ? settleStandIn(t) : Promise.resolve())));

        // Floating grade layers: pre-compose everything painted beneath each one and bake its
        // backdrop-filter via canvas 2d (see gradeLayerPass.ts). Before the glass pass, so
        // backdrop-blurred overlays sample the GRADED composite.
        const cleanupGradeLayers = await bakeGradeLayers(host, {
          pixelRatio,
          fontEmbedCSS,
          baseFilter: (node) =>
            !(node instanceof HTMLVideoElement) &&
            !(node instanceof HTMLCanvasElement && node.hasAttribute("data-framediff-webgpu")),
        });

        // backdrop-filter: html-to-image's foreignObject rasterization cannot sample the backdrop,
        // so glass surfaces silently lose their blur. Pre-compose them: capture the layers BENEATH
        // the element (top-level layers before the one containing it), crop its rect (padded so the
        // blur has context), apply the same filter via canvas 2d, and inject the result as a temp
        // layer inside the element — suppressing the CSS backdrop-filter/background during capture.
        const bfEls = Array.from(host.querySelectorAll<HTMLElement>("*")).filter((el) => {
          if (!isVisualElementActive(el, host)) return false;
          if (el.hasAttribute("data-framediff-gradelayer")) return false; // baked above, full-frame semantics
          const s = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
          const bf = s.backdropFilter && s.backdropFilter !== "none" ? s.backdropFilter : s.webkitBackdropFilter;
          return !!bf && bf !== "none";
        });
        const bfRestore: { el: HTMLElement; backdropFilter: string; webkit: string; background: string }[] = [];
        if (bfEls.length) {
          const topLayers = Array.from(host.children);
          const layerOf = (el: HTMLElement) => topLayers.findIndex((c) => c.contains(el));
          const firstOverlay = Math.min(...bfEls.map(layerOf).filter((i) => i >= 0));
          const excluded = new Set(topLayers.slice(firstOverlay));
          const base = await toCanvas(host, {
            pixelRatio,
            fontEmbedCSS,
            cacheBust: false,
            filter: (node) =>
              !(node instanceof HTMLVideoElement) &&
              !(node instanceof HTMLCanvasElement && node.hasAttribute("data-framediff-webgpu")) &&
              !(node instanceof Element && [...excluded].some((l) => l === node || l.contains(node))),
          });
          const hostRect = host.getBoundingClientRect();
          for (const el of bfEls) {
            const s = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
            const bf = s.backdropFilter && s.backdropFilter !== "none" ? s.backdropFilter! : s.webkitBackdropFilter!;
            const r = el.getBoundingClientRect();
            const pad = 64; // context for the blur kernel at the crop edges
            const x = (r.left - hostRect.left - pad) * pixelRatio;
            const y = (r.top - hostRect.top - pad) * pixelRatio;
            const w = (r.width + pad * 2) * pixelRatio;
            const h = (r.height + pad * 2) * pixelRatio;
            const c = document.createElement("canvas");
            c.width = Math.max(2, Math.round(w));
            c.height = Math.max(2, Math.round(h));
            const ctx = c.getContext("2d")!;
            ctx.filter = bf;
            ctx.drawImage(base, x, y, w, h, 0, 0, c.width, c.height);
            const img = document.createElement("img");
            img.src = c.toDataURL("image/png");
            img.style.cssText = `position:absolute;left:${-pad}px;top:${-pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;max-width:none;`;
            const tint = document.createElement("div");
            tint.style.cssText = `position:absolute;inset:0;background:${s.backgroundColor};`;
            el.prepend(tint);
            el.prepend(img);
            temps.push(img, tint as unknown as HTMLImageElement);
            bfRestore.push({
              el,
              backdropFilter: el.style.backdropFilter,
              webkit: (el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter ?? "",
              background: el.style.backgroundColor,
            });
            el.style.backdropFilter = "none";
            (el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = "none";
            el.style.backgroundColor = "transparent";
          }
        }

        await Promise.all(temps.map((t) => (t instanceof HTMLImageElement ? settleStandIn(t) : Promise.resolve())));

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
        for (const r of bfRestore) {
          r.el.style.backdropFilter = r.backdropFilter;
          (r.el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = r.webkit;
          r.el.style.backgroundColor = r.background;
        }
        const bitmap = await createImageBitmap(canvas);

        inflight++;
        worker.postMessage({ type: "frame", n: n - startFrame, bitmap }, [bitmap]);
        framesRendered = n - startFrame + 1;
        emitProgress();
        while (inflight > 2) {
          if (fatalError) throw fatalError;
          throwIfAborted();
          await waitForLoopWake();
        }
      }

      phase = "finalize";
      emitProgress();

      // --- audio PCM → worker ---
      if (mixed) {
        const ch0 = mixed.getChannelData(0).slice();
        const ch1 = (mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : mixed.getChannelData(0)).slice();
        worker.postMessage(
          { type: "audio", channels: [ch0.buffer, ch1.buffer], length: mixed.length, sampleRate: SAMPLE_RATE },
          [ch0.buffer, ch1.buffer],
        );
      }

      worker.postMessage({ type: "finish" });
      return await done;
    } catch (err) {
      if (output.kind === "stream" && !sinkClosed) {
        await Promise.resolve(output.sink.abort?.(err)).catch(() => {});
        sinkClosed = true;
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await Promise.resolve();
      worker.terminate();
    }
  } finally {
    document.removeEventListener("freeze", onFreeze);
    releaseLock();
    captureFlag.__FRAMEDIFF_CAPTURE_MODE__ = previousCaptureMode;
    handle.destroy();
    wrapper.remove();
    VideoFrameSource.clearBlobCache();
  }
}

export async function exportVideo(comp: CompositionConfig, opts: ExportOptions): Promise<ArrayBuffer> {
  return (await exportVideoInternal(comp, opts, { kind: "buffer" })) as ArrayBuffer;
}

export async function exportVideoToSink(
  comp: CompositionConfig,
  opts: ExportVideoSinkOptions,
): Promise<ExportVideoStreamResult> {
  const { sink, streamFastStart, ...exportOpts } = opts;
  return (await exportVideoInternal(comp, exportOpts, {
    kind: "stream",
    sink,
    fastStart: streamFastStart ?? false,
  })) as ExportVideoStreamResult;
}

export async function exportVideoToWritable(
  comp: CompositionConfig,
  opts: ExportVideoWritableOptions,
): Promise<ExportVideoStreamResult> {
  const { writable, ...exportOpts } = opts;
  return exportVideoToSink(comp, {
    ...exportOpts,
    sink: createAppendWritableSink(writable),
    streamFastStart: "fragmented",
  });
}

export async function exportVideoToFileSystemWritable(
  comp: CompositionConfig,
  opts: ExportVideoFileSystemOptions,
): Promise<ExportVideoStreamResult> {
  const { writable, ...exportOpts } = opts;
  return exportVideoToSink(comp, {
    ...exportOpts,
    sink: createFileSystemWritableSink(writable),
    streamFastStart: false,
  });
}
