// Always-on-top render progress HUD via Document Picture-in-Picture (Chrome 116+).
// The export pipeline keeps rendering while the main window is minimized; this floating
// window is the progress readout + cancel button that stays visible when it does.
//
// requestWindow() requires transient user activation, and activation-consuming calls that
// may precede it (showSaveFilePicker) can spend it — openRenderHud resolves null in that
// case, and callers fall back to a pop-out button (a fresh click) in the Studio chrome.

import type { ExportProgress } from "../render/exportVideo";

interface DocPiP {
  requestWindow(opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
}

export interface RenderStats {
  etaSeconds: number | null;
  fps: number | null;
  elapsedSeconds: number;
}

/** Rolling-window render rate → ETA. Feed it the frames-done counter; window is the last ~5s. */
export function createEtaTracker(): { update(framesDone: number, totalFrames: number): RenderStats } {
  const t0 = performance.now();
  const samples: { t: number; frames: number }[] = [];
  return {
    update(framesDone, totalFrames) {
      const now = performance.now();
      samples.push({ t: now, frames: framesDone });
      while (samples.length > 2 && (now - samples[0].t > 5000 || samples.length > 120)) samples.shift();
      const first = samples[0];
      const dt = (now - first.t) / 1000;
      const df = framesDone - first.frames;
      const fps = dt > 0.5 && df > 0 ? df / dt : null;
      const etaSeconds = fps ? Math.max(0, (totalFrames - framesDone) / fps) : null;
      return { etaSeconds, fps, elapsedSeconds: (now - t0) / 1000 };
    },
  };
}

export function formatSeconds(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "–:––";
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export interface RenderHud {
  update(p: ExportProgress, stats: RenderStats): void;
  finish(msg: string): void;
  fail(msg: string): void;
  close(): void;
  readonly closed: boolean;
}

const HUD_CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0e0d0b; color: #f5efdd; overflow: hidden; user-select: none;
         font: 11px "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
  .hud { display: flex; flex-direction: column; gap: 9px; padding: 13px 14px; }
  .top { display: flex; align-items: baseline; gap: 8px; }
  .title { font-weight: 700; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pct { color: #c6c0af; margin-left: auto; }
  .bar { height: 6px; border-radius: 3px; background: #242019; overflow: hidden; }
  .fill { height: 100%; width: 0%; border-radius: 3px; background: linear-gradient(90deg, #c9923d, #e0ac57);
          transition: width 0.2s ease; }
  .fill.ok { background: #7fc79b; }
  .fill.err { background: #e0655f; }
  .meta { display: flex; align-items: center; gap: 8px; color: #c6c0af; }
  .phase { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stats { margin-left: auto; white-space: nowrap; }
  button { margin-left: 4px; padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14);
           background: #1b1815; color: #f5efdd; font: inherit; cursor: pointer; flex: none; }
  button:hover { border-color: #e0655f; color: #e0655f; }
  button.ok:hover { border-color: #e0ac57; color: #e0ac57; }
`;

export async function openRenderHud(opts: {
  title: string;
  onCancel: () => void;
  onClosed?: () => void;
}): Promise<RenderHud | null> {
  const dpip = (window as unknown as { documentPictureInPicture?: DocPiP }).documentPictureInPicture;
  if (!dpip) return null;
  let win: Window;
  try {
    win = await dpip.requestWindow({ width: 340, height: 96, disallowReturnToOpener: true });
  } catch {
    return null; // no transient activation left (e.g. spent on the save picker) — caller offers pop-out
  }

  const doc = win.document;
  doc.title = `render · ${opts.title}`;
  const style = doc.createElement("style");
  style.textContent = HUD_CSS;
  doc.head.appendChild(style);
  doc.body.innerHTML = `
    <div class="hud">
      <div class="top"><span class="title"></span><span class="pct"></span></div>
      <div class="bar"><div class="fill"></div></div>
      <div class="meta"><span class="phase">starting…</span><span class="stats"></span><button>cancel</button></div>
    </div>`;
  const el = (sel: string) => doc.querySelector(sel) as HTMLElement;
  el(".title").textContent = opts.title;
  const fill = el(".fill");
  const pct = el(".pct");
  const phaseEl = el(".phase");
  const statsEl = el(".stats");
  const button = doc.querySelector("button")!;

  let closed = false;
  let settled = false; // finished or failed — stop accepting progress
  let last: { p: ExportProgress; stats: RenderStats } | null = null;

  const paint = () => {
    if (!last || settled) return;
    const { p, stats } = last;
    const done = p.phase === "audio" ? p.audioFramesScanned : p.framesEncoded;
    const frac = p.phase === "finalize" ? 1 : p.totalFrames ? done / p.totalFrames : 0;
    fill.style.width = `${Math.round(frac * 100)}%`;
    pct.textContent = p.phase === "render" || p.phase === "finalize" ? `${Math.round(frac * 100)}%` : "";
    const bytes = p.bytesWritten ? ` · ${formatBytes(p.bytesWritten)}` : "";
    phaseEl.textContent =
      p.phase === "prepare"
        ? "preparing assets…"
        : p.phase === "audio"
          ? `audio pass · frame ${p.audioFramesScanned}/${p.totalFrames}`
          : p.phase === "render"
            ? `frame ${p.framesEncoded}/${p.totalFrames}${bytes}`
            : `finalizing mp4${bytes}`;
    statsEl.textContent =
      p.phase === "render"
        ? `${stats.fps ? stats.fps.toFixed(1) : "–"} fps · eta ${formatSeconds(stats.etaSeconds)}`
        : `${formatSeconds(stats.elapsedSeconds)} elapsed`;
  };
  // elapsed/eta keep ticking between progress events; this window is visible, so its timers run
  const ticker = win.setInterval(paint, 1000);

  const close = () => {
    if (closed) return;
    closed = true;
    win.clearInterval(ticker);
    win.close();
  };
  win.addEventListener("pagehide", () => {
    closed = true;
    opts.onClosed?.();
  });
  button.addEventListener("click", () => {
    if (settled) close();
    else opts.onCancel();
  });

  const settle = (msg: string, ok: boolean) => {
    if (closed) return;
    settled = true;
    fill.style.width = "100%";
    fill.className = `fill ${ok ? "ok" : "err"}`;
    pct.textContent = "";
    phaseEl.textContent = msg;
    statsEl.textContent = "";
    button.textContent = "close";
    button.className = "ok";
    if (ok) win.setTimeout(close, 5000);
  };

  return {
    get closed() {
      return closed;
    },
    update(p, stats) {
      if (closed || settled) return;
      last = { p, stats };
      paint();
    },
    finish: (msg) => settle(msg, true),
    fail: (msg) => settle(msg, false),
    close,
  };
}
