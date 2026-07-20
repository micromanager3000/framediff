import { describe, expect, it } from "vitest";
import { videoFrameSource } from "./videoSource";

const video = (src: string | null, currentSrc = "", fdSrc = "") => ({
  getAttribute: (name: string) => name === "src" ? src : null,
  currentSrc,
  dataset: { fdSrc },
}) as unknown as HTMLVideoElement;

describe("videoFrameSource", () => {
  it("skips a deliberately source-less video placeholder", () => {
    expect(videoFrameSource(video(null))).toBe("");
    expect(videoFrameSource(video("   "))).toBe("");
  });

  it("uses reflected, current, or runtime-authored sources in order", () => {
    expect(videoFrameSource(video("/attribute.mp4", "/current.mp4", "/data.mp4"))).toBe("/attribute.mp4");
    expect(videoFrameSource(video(null, "/current.mp4", "/data.mp4"))).toBe("/current.mp4");
    expect(videoFrameSource(video(null, "", "/data.mp4"))).toBe("/data.mp4");
  });
});
