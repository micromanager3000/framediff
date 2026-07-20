import { describe, expect, it } from "vitest";
import { sourceFrameForMode, sourceTimeAtFrame } from "./videoSourceFrame";

const canvas = {} as HTMLCanvasElement;
const video = {} as HTMLVideoElement;

describe("sourceFrameForMode", () => {
  it("samples source video at the middle of the frame interval", () => {
    expect(sourceTimeAtFrame(10, 25, 2, 1.5)).toBeCloseTo(2 + (10.5 / 25) * 1.5, 12);
  });

  it("does not fall back to HTMLVideoElement in capture mode", async () => {
    let fallbackCalls = 0;
    const primaryStalled = { current: false };
    const got = await sourceFrameForMode({
      frameSrc: { frameCanvas: async () => null },
      url: "/__framediff-cache/clip.mp4",
      t: 1,
      vid: video,
      width: 1920,
      height: 1080,
      primaryStalled,
      captureMode: true,
      videoElementFrame: async () => {
        fallbackCalls++;
        return canvas;
      },
    });

    expect(got).toBeNull();
    expect(fallbackCalls).toBe(0);
    expect(primaryStalled.current).toBe(false);
  });

  it("uses exact decode for cache URLs in capture mode", async () => {
    let decodedUrl = "";
    const got = await sourceFrameForMode({
      frameSrc: {
        frameCanvas: async (url) => {
          decodedUrl = url;
          return canvas;
        },
      },
      url: "/__framediff-cache/proxy.mp4",
      t: 1,
      vid: video,
      width: 1920,
      height: 1080,
      primaryStalled: { current: false },
      captureMode: true,
      videoElementFrame: async () => {
        throw new Error("fallback should not run");
      },
    });

    expect(got).toBe(canvas);
    expect(decodedUrl).toBe("/__framediff-cache/proxy.mp4");
  });

  it("keeps preview responsive by falling back after primary decode misses", async () => {
    let fallbackCalls = 0;
    const primaryStalled = { current: false };
    const got = await sourceFrameForMode({
      frameSrc: { frameCanvas: async () => null },
      url: "/clip.mp4",
      t: 1,
      vid: video,
      width: 1920,
      height: 1080,
      primaryStalled,
      captureMode: false,
      previewDecodeTimeoutMs: 1,
      videoElementFrame: async () => {
        fallbackCalls++;
        return canvas;
      },
    });

    expect(got).toBe(canvas);
    expect(fallbackCalls).toBe(1);
    expect(primaryStalled.current).toBe(true);
  });
});
