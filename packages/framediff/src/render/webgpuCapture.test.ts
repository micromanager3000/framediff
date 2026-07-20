import { describe, expect, it } from "vitest";
import { waitForWebGpuCapture, type WebGpuCaptureHolder } from "./webgpuCapture";

describe("waitForWebGpuCapture", () => {
  it("returns an existing capture hook immediately", async () => {
    const cap = async () => ({} as HTMLCanvasElement);
    await expect(waitForWebGpuCapture({ __framediffCapture: cap }, { polls: 0 })).resolves.toBe(cap);
  });

  it("waits for async WebGPU setup", async () => {
    const holder: WebGpuCaptureHolder = {};
    const cap = async () => ({} as HTMLCanvasElement);
    let sleeps = 0;
    const got = await waitForWebGpuCapture(holder, {
      polls: 3,
      sleep: async () => {
        sleeps++;
        if (sleeps === 2) holder.__framediffCapture = cap;
      },
    });

    expect(got).toBe(cap);
    expect(sleeps).toBe(2);
  });

  it("throws instead of silently dropping the WebGPU layer", async () => {
    await expect(waitForWebGpuCapture({}, {
      polls: 2,
      sleep: async () => {},
      label: "frame 42",
    })).rejects.toThrow(/frame 42/);
  });
});
