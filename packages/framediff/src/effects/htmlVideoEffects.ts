import type { CompositionSetup } from "../composition";
import { registerCanvasCapture } from "../runtime";
import { VideoFrameSource } from "../render/videoFrames";
import { isVisualElementActive } from "../render/activeElement";
import { createGradeRenderer, type GradeParams } from "./grade";
import { generateWarmGoldLUT, type LUT3D } from "./lut";
import { createScene3DRenderer, type Plane3DParams } from "./scene3d";
import type { V3 } from "./mat4";
import { cameraPoseAtFrame, type CameraInterpolation, type CameraKeyframe, type VirtualCameraPose } from "./camera";

const numeric = (element: Element, name: string, fallback: number): number => {
  const owner = element.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  const source = owner?.hasAttribute(name) ? owner : element;
  const parsed = Number(source.getAttribute(name));
  return source.hasAttribute(name) && Number.isFinite(parsed) ? parsed : fallback;
};

const inherited = (element: Element, name: string): string | null => {
  const owner = element.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  return owner?.getAttribute(name) ?? element.getAttribute(name);
};

const gradeOf = (element: Element, bypass: boolean): GradeParams => bypass ? { lutIntensity: 0 } : {
  exposure: numeric(element, "data-fd-grade-exposure", 0),
  contrast: numeric(element, "data-fd-grade-contrast", 0),
  saturation: numeric(element, "data-fd-grade-saturation", 1),
  temperature: numeric(element, "data-fd-grade-temperature", 0),
  tint: numeric(element, "data-fd-grade-tint", 0),
  highlights: numeric(element, "data-fd-grade-highlights", 0),
  shadows: numeric(element, "data-fd-grade-shadows", 0),
  vignette: numeric(element, "data-fd-grade-vignette", 0),
  bloom: numeric(element, "data-fd-grade-bloom", 0),
  bloomThreshold: numeric(element, "data-fd-grade-bloom-threshold", 0.6),
  lutIntensity: numeric(element, "data-fd-lut-intensity", inherited(element, "data-fd-lut") ? 1 : 0),
};

function localFrame(element: Element, fallback: number): number {
  const clip = element.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
  return Number(clip?.dataset.fdLocalFrame ?? fallback);
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(time, Math.max(0, (video.duration || time + 1) - 0.05)));
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.04) return resolve();
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    video.addEventListener("seeked", finish, { once: true });
    try { video.currentTime = target; } catch { finish(); }
    setTimeout(finish, 800);
  });
}

function previewVideo(url: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.cssText = "position:fixed;left:-99999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  try { video.load(); } catch { /* optional preview media */ }
  return video;
}

async function sourceFrame(frames: VideoFrameSource, url: string, time: number, video: HTMLVideoElement): Promise<HTMLCanvasElement | HTMLVideoElement> {
  if ((window as { __FRAMEDIFF_CAPTURE_MODE__?: boolean }).__FRAMEDIFF_CAPTURE_MODE__) {
    const canvas = await frames.frameCanvas(url, time);
    if (!canvas) throw new Error(`Could not decode ${url} at ${time.toFixed(3)}s.`);
    return canvas;
  }
  await seek(video, time);
  return video.readyState >= 2 && video.videoWidth > 0 ? video : await frames.frameCanvas(url, time) ?? video;
}

/** Serialize browser video seeks while retaining only the newest queued frame. The completed
 * seek is still painted before the newest request starts, so a drag keeps visibly progressing
 * instead of staying frozen until the pointer stops. */
function createLatestPreviewFrameQueue<T>(work: (value: T) => Promise<void>) {
  let pending: T | undefined;
  let running = false;
  let disposed = false;
  let idleWaiters: Array<() => void> = [];

  const settleIdle = () => {
    if (running || pending !== undefined) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  };
  const pump = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed && pending !== undefined) {
        const value = pending;
        pending = undefined;
        try {
          await work(value);
        } catch (error) {
          if (!disposed) console.error("FrameDiff preview frame failed.", error);
        }
      }
    } finally {
      running = false;
      if (!disposed && pending !== undefined) void pump();
      else settleIdle();
    }
  };

  return {
    get disposed() { return disposed; },
    push(value: T) {
      if (disposed) return;
      pending = value;
      void pump();
    },
    clear() {
      pending = undefined;
      settleIdle();
    },
    dispose() {
      disposed = true;
      pending = undefined;
      settleIdle();
    },
    idle() {
      return !running && pending === undefined
        ? Promise.resolve()
        : new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

export interface GradeVideoSetupOptions {
  selector?: string;
  lut?: "gold" | LUT3D;
  /** Resolve a per-canvas LUT after project data has loaded. Wins over `lut`. */
  lutFor?: (element: HTMLCanvasElement) => "gold" | LUT3D | undefined | Promise<"gold" | LUT3D | undefined>;
}

/** Drive HTML canvases carrying `data-fd-grade-video` through the existing WebGPU grade renderer. */
export function createGradeVideoSetup(options: GradeVideoSetupOptions = {}): CompositionSetup {
  return async ({ root, composition, resolver, onFrame, onCleanup }) => {
    const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>(options.selector ?? "canvas[data-fd-grade-video]"));
    await Promise.all(canvases.map(async (canvas) => {
      const ref = inherited(canvas, "data-fd-src") ?? "";
      const url = resolver ? (await resolver.resolve(ref)).url : ref;
      const width = numeric(canvas, "data-fd-render-width", composition.width);
      const height = numeric(canvas, "data-fd-render-height", composition.height);
      canvas.width = width;
      canvas.height = height;
      canvas.style.width ||= "100%";
      canvas.style.height ||= "100%";
      const renderer = await createGradeRenderer(canvas, width, height, { fitSource: true });
      if (!renderer) return;
      const lut = await options.lutFor?.(canvas) ?? options.lut ?? (inherited(canvas, "data-fd-lut") === "gold" ? "gold" : undefined);
      if (lut) renderer.setLUT(lut === "gold" ? generateWarmGoldLUT(33) : lut);
      const video = previewVideo(url);
      const frames = new VideoFrameSource();
      let grade = gradeOf(canvas, false);
      const previewFrames = createLatestPreviewFrameQueue(async (request: { target: number; grade: GradeParams }) => {
        const source = await sourceFrame(frames, url, request.target, video);
        if (previewFrames.disposed || !isVisualElementActive(canvas, root)) return;
        if (source instanceof HTMLVideoElement && source.readyState < 2) return;
        await renderer.render(source, request.grade);
        canvas.dataset.framediffRenderedTime = String(request.target);
      });
      const stopFrame = onFrame((state) => {
        if (!isVisualElementActive(canvas, root)) {
          previewFrames.clear();
          return;
        }
        const frame = localFrame(canvas, state.frame);
        const target = numeric(canvas, "data-fd-trim-start", 0) + ((frame + 0.5) / composition.fps) * numeric(canvas, "data-fd-playback-rate", 1);
        canvas.dataset.framediffTime = String(target);
        grade = gradeOf(canvas, state.gradeBypass);
        // Exact capture decodes and renders through the registered capture callback below.
        // Repeating that work here can race the capture and duplicate media errors.
        if ((window as { __FRAMEDIFF_CAPTURE_MODE__?: boolean }).__FRAMEDIFF_CAPTURE_MODE__) {
          previewFrames.clear();
          return;
        }
        previewFrames.push({ target, grade });
      });
      const stopCapture = registerCanvasCapture(canvas, async (time) => {
        const source = await frames.frameCanvas(url, time);
        if (!source) throw new Error(`Could not decode ${url} at ${time.toFixed(3)}s.`);
        return renderer.capture(source, grade);
      });
      onCleanup(() => { stopFrame(); stopCapture(); previewFrames.dispose(); renderer.destroy(); video.remove(); });
    }));
  };
}

export interface VideoPlane3DSetupOptions {
  selector?: string;
  cameraFrom?: VirtualCameraPose;
  cameraTo?: VirtualCameraPose;
  cameraKeyframes?: CameraKeyframe[];
  cameraInterpolation?: CameraInterpolation;
  planePosition?: V3;
  planeRotation?: V3;
  planeScale?: number | V3;
  planeSize?: [number, number];
  maxBlur?: number;
  dofModel?: "linear" | "thinLens";
  motionBlur?: boolean | { shutterAngle?: number; samples?: number };
  lut?: "gold" | LUT3D;
  /** Resolve a per-canvas LUT after project data has loaded. Wins over `lut`. */
  lutFor?: (element: HTMLCanvasElement) => "gold" | LUT3D | undefined | Promise<"gold" | LUT3D | undefined>;
}

function planePose(element: Element, frame: number, duration: number, options: VideoPlane3DSetupOptions, bypass: boolean): Plane3DParams {
  const from = options.cameraFrom ?? {};
  const to = options.cameraTo ?? from;
  const keyframes = options.cameraKeyframes?.length ? options.cameraKeyframes : [
    { frame: 0, pose: from },
    { frame: Math.max(1, duration - 1), pose: to },
  ];
  const evaluate = (sampleFrame: number) => cameraPoseAtFrame({
      keyframes,
      frame: sampleFrame,
      plane: { position: options.planePosition, rotation: options.planeRotation, scale: options.planeScale },
      maxBlur: numeric(element, "data-fd-prop-max-blur", options.maxBlur ?? 0.03),
      interpolation: options.cameraInterpolation,
    });
  const pose = evaluate(frame);
  if (options.planeSize) pose.planeSize = options.planeSize;
  if (options.dofModel && pose.dof) pose.dof.model = options.dofModel;
  if (options.motionBlur) {
    const settings = options.motionBlur === true ? {} : options.motionBlur;
    const shutterFrames = (settings.shutterAngle ?? 180) / 360;
    const samples = Math.max(2, Math.min(16, settings.samples ?? 9));
    pose.shutterPoses = Array.from({ length: samples }, (_, index) => (index / (samples - 1) - 0.5) * shutterFrames)
      .filter((offset) => Math.abs(offset) > 1e-6)
      .map((offset) => evaluate(frame + offset));
  }
  return {
    ...pose,
    grade: gradeOf(element, bypass),
  };
}

/** Drive a video texture on an animated 3D plane from an ordinary authored canvas. */
export function createVideoPlane3DSetup(options: VideoPlane3DSetupOptions = {}): CompositionSetup {
  return async ({ root, composition, resolver, onFrame, onCleanup }) => {
    const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>(options.selector ?? "canvas[data-fd-video-plane-3d]"));
    await Promise.all(canvases.map(async (canvas) => {
      const ref = inherited(canvas, "data-fd-src") ?? "";
      const url = resolver ? (await resolver.resolve(ref)).url : ref;
      const width = numeric(canvas, "data-fd-render-width", composition.width);
      const height = numeric(canvas, "data-fd-render-height", composition.height);
      canvas.width = width;
      canvas.height = height;
      const renderer = await createScene3DRenderer(canvas, width, height);
      if (!renderer) return;
      const lut = await options.lutFor?.(canvas) ?? options.lut ?? (inherited(canvas, "data-fd-lut") === "gold" ? "gold" : undefined);
      if (lut) renderer.setLUT(lut === "gold" ? generateWarmGoldLUT(33) : lut);
      const video = previewVideo(url);
      const frames = new VideoFrameSource();
      let pose = planePose(canvas, 0, composition.durationInFrames, options, false);
      const previewFrames = createLatestPreviewFrameQueue(async (request: { target: number; pose: Plane3DParams }) => {
        const source = await sourceFrame(frames, url, request.target, video);
        if (previewFrames.disposed || !isVisualElementActive(canvas, root)) return;
        if (source instanceof HTMLVideoElement && source.readyState < 2) return;
        await renderer.render(source, request.pose);
        canvas.dataset.framediffRenderedTime = String(request.target);
      });
      const stopFrame = onFrame((state) => {
        if (!isVisualElementActive(canvas, root)) {
          previewFrames.clear();
          return;
        }
        const clip = canvas.closest<HTMLElement>("[data-fd-clip], [data-fd-from], [data-fd-duration]");
        const frame = localFrame(canvas, state.frame);
        const duration = Number(clip?.getAttribute("data-fd-duration") ?? composition.durationInFrames);
        const target = numeric(canvas, "data-fd-trim-start", 0) + ((frame + 0.5) / composition.fps) * numeric(canvas, "data-fd-playback-rate", 1);
        canvas.dataset.framediffTime = String(target);
        pose = planePose(canvas, frame, duration, options, state.gradeBypass);
        if ((window as { __FRAMEDIFF_CAPTURE_MODE__?: boolean }).__FRAMEDIFF_CAPTURE_MODE__) {
          previewFrames.clear();
          return;
        }
        previewFrames.push({ target, pose });
      });
      const stopCapture = registerCanvasCapture(canvas, async (time) => {
        const source = await frames.frameCanvas(url, time);
        if (!source) throw new Error(`Could not decode ${url} at ${time.toFixed(3)}s.`);
        return renderer.capture(source, pose);
      });
      onCleanup(() => { stopFrame(); stopCapture(); previewFrames.dispose(); renderer.destroy(); video.remove(); });
    }));
  };
}

export const __htmlVideoEffectsTest = { createLatestPreviewFrameQueue };
