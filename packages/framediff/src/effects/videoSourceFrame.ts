import type { VideoFrameSource } from "../render/videoFrames";

const DEFAULT_PREVIEW_DECODE_TIMEOUT_MS = 350;

const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

export type CaptureModeProvider = () => boolean;

export const isFrameDiffCaptureMode: CaptureModeProvider = () =>
  typeof window !== "undefined" && (window as unknown as { __FRAMEDIFF_CAPTURE_MODE__?: boolean }).__FRAMEDIFF_CAPTURE_MODE__ === true;

export function sourceTimeAtFrame(frame: number, fps: number, trimStart = 0, playbackRate = 1): number {
  return trimStart + ((frame + 0.5) / fps) * playbackRate;
}

export interface SourceFrameOptions {
  frameSrc: Pick<VideoFrameSource, "frameCanvas">;
  url: string;
  t: number;
  vid: HTMLVideoElement | null;
  width: number;
  height: number;
  primaryStalled: { current: boolean };
  captureMode?: boolean;
  previewDecodeTimeoutMs?: number;
  videoElementFrame: (vid: HTMLVideoElement, t: number, width: number, height: number) => Promise<HTMLCanvasElement | null>;
}

export async function sourceFrameForMode({
  frameSrc,
  url,
  t,
  vid,
  width,
  height,
  primaryStalled,
  captureMode = isFrameDiffCaptureMode(),
  previewDecodeTimeoutMs = DEFAULT_PREVIEW_DECODE_TIMEOUT_MS,
  videoElementFrame,
}: SourceFrameOptions): Promise<HTMLCanvasElement | null> {
  if (captureMode) {
    return await frameSrc.frameCanvas(url, t).catch(() => null);
  }

  if (!primaryStalled.current) {
    const primary = await Promise.race([frameSrc.frameCanvas(url, t).catch(() => null), timeout(previewDecodeTimeoutMs)]);
    if (primary) return primary;
    primaryStalled.current = true;
  }

  return vid ? videoElementFrame(vid, t, width, height) : null;
}
