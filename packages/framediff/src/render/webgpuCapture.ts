import { bgDelay } from "./bgTimer";

export type WebGpuCapture = (t: number) => Promise<HTMLCanvasElement>;
export type WebGpuCaptureHolder = { __framediffCapture?: WebGpuCapture };

export interface WaitForWebGpuCaptureOptions {
  polls?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  label?: string;
}

export async function waitForWebGpuCapture(
  holder: WebGpuCaptureHolder,
  { polls = 80, intervalMs = 50, sleep = bgDelay, label }: WaitForWebGpuCaptureOptions = {},
): Promise<WebGpuCapture> {
  let cap = holder.__framediffCapture;
  for (let i = 0; !cap && i < polls; i++) {
    await sleep(intervalMs);
    cap = holder.__framediffCapture;
  }
  if (!cap) {
    throw new Error(`WebGPU layer did not install a capture hook${label ? ` (${label})` : ""}`);
  }
  return cap;
}
