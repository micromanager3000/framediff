import type { AnimationClock } from "@framediff/studio-model";

export const browserAnimationClock: AnimationClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};
