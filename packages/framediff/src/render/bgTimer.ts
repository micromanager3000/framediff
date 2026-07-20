// Delays that keep ticking while the window is hidden. Main-thread setTimeout in a hidden
// page is clamped to ≥1s — and chained timers to once per MINUTE after five minutes hidden
// (Chrome's intensive throttling) — which would stall a minimized export. Dedicated-worker
// timers are exempt, so delays are scheduled in a tiny inline worker instead.

let timerWorker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, () => void>();

function getTimerWorker(): Worker | null {
  if (timerWorker !== undefined) return timerWorker;
  try {
    const src = "onmessage=(e)=>{setTimeout(()=>postMessage(e.data.id),e.data.ms)}";
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    timerWorker = new Worker(url);
    URL.revokeObjectURL(url);
    timerWorker.onmessage = (e: MessageEvent<number>) => {
      const resolve = pending.get(e.data);
      pending.delete(e.data);
      resolve?.();
    };
  } catch {
    timerWorker = null; // no Worker/blob-worker support (jsdom, strict CSP) — fall back
  }
  return timerWorker;
}

/** Resolve after `ms` even in a hidden window. Falls back to setTimeout where Workers are unavailable. */
export function bgDelay(ms: number): Promise<void> {
  const w = getTimerWorker();
  if (!w) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    w.postMessage({ id, ms });
  });
}
