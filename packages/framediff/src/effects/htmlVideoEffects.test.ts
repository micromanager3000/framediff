import { describe, expect, it } from "vitest";
import { __htmlVideoEffectsTest } from "./htmlVideoEffects";

describe("latest preview frame queue", () => {
  it("paints an in-flight frame and then coalesces queued seeks to the newest frame", async () => {
    const started: number[] = [];
    const painted: number[] = [];
    let releaseFirst!: () => void;
    const firstFrame = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queue = __htmlVideoEffectsTest.createLatestPreviewFrameQueue(async (frame: number) => {
      started.push(frame);
      if (frame === 1) await firstFrame;
      painted.push(frame);
    });

    queue.push(1);
    queue.push(2);
    queue.push(3);
    expect(started).toEqual([1]);

    releaseFirst();
    await queue.idle();
    expect(painted).toEqual([1, 3]);
    expect(started).toEqual([1, 3]);
  });
});
