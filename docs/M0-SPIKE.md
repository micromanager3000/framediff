# M0 Spike — Deterministic in-browser render

> **Status:** Draft v0.1 · **Date:** 2026-06-23 · **Milestone:** M0 (see [PRD §13](PRD.md#13-roadmap--milestones))
> **Type:** Throwaway spike. The goal is a *learning*, not production code. Most of this gets rewritten in M1.

---

## 1. Hypothesis (the one thing M0 proves)

> **In a pure web app, a composition expressed as a pure function of the frame number can be rendered frame-by-frame to a playable MP4 via WebCodecs and written to local disk via the File System Access API — and the preview is pixel-identical to the export.**

If this holds, the core technical premise of the whole product (`f(frame) → pixels`, "preview = render", pure-web, no desktop shell) is real. If it doesn't, we learn the constraint *now*, before building the editor, sync engine, or effects.

Everything else in the PRD is downstream of this loop working.

---

## 2. Scope

### In (must)
- A **hardcoded** composition: `drawFrame(ctx, frame, meta)` — a pure function. No editor, no UI to author it.
- An **interactive preview**: a `<canvas>` + a playhead slider that calls `drawFrame` for the scrubbed frame.
- An **offline render loop**: iterate `frame = 0..N`, draw, capture as `VideoFrame`, encode (H.264), mux to MP4.
- **Write to disk** via `showSaveFilePicker()` → `createWritable()`.
- A **determinism harness**: hash the composited pixels of a chosen frame; assert it's stable across runs/reloads.

### Out (explicitly deferred — do NOT build in M0)
- ❌ **HTML/CSS overlay capture** — deterministic DOM→frame rasterization is its own hard problem (see §8). M0 draws to canvas only.
- ❌ WebGPU effects (stretch goal only, §7).
- ❌ Audio.
- ❌ The code↔UI sync engine, the React component API, `ts-morph`, FileSystemObserver.
- ❌ The headless CLI, cloud render, multi-format/publish.
- ❌ Loading source video via `VideoDecoder` (the spike composition is synthetic — no input media).

> Keeping input media out matters: M0 proves the **output** half of the pipeline (compose → encode → write). Decoding source frames is M1+.

---

## 3. The determinism model

This is the heart of the spike.

- **The frame is the only input.** `drawFrame(ctx, n, meta)` must depend on `n` (and static `meta`) and *nothing else*: no `Date.now()`, no `performance.now()`, no `Math.random()` (use a seeded PRNG if needed), no `requestAnimationFrame`-driven state. Time is derived: `t = n / fps`.
- **Preview and export call the same `drawFrame`.** The preview is just `drawFrame` driven by a slider; the export is `drawFrame` driven by a counter. That shared function *is* the "preview = render" guarantee.
- **The determinism guarantee is at the pre-encode pixel level**, not the encoded bytes. H.264 output can differ across hardware/software encoders, so we hash the **composited canvas pixels**, not the `.mp4`. (This also previews the GPU-nondeterminism caveat in [PRD §11.1](PRD.md#111-determinism-contract-hard-requirement).)
- **Cross-machine caveat:** Canvas2D text uses system fonts → can differ across OSes. For same-machine M0 this is fine; for true cross-machine reproducibility we'd embed a webfont and `await document.fonts.ready`. Note it, don't solve it in M0.

---

## 4. Architecture

```
                drawFrame(ctx, n, meta)   ← the composition (pure)
                      │
        ┌─────────────┴──────────────┐
        ▼                            ▼
  PREVIEW path                  RENDER path
  canvas + slider          for n in 0..N:
  draw(scrubFrame)           draw(n)
                             VideoFrame(canvas, ts=n·1e6/fps)
                             VideoEncoder.encode  ──► mp4-muxer ──► ArrayBuffer
                                                                      │
                                                   showSaveFilePicker ▼
                                                   writable.write(buffer) → disk
```

Same `drawFrame`, two drivers. M0 v1 runs the render loop on the main thread; moving it into a **Web Worker + `OffscreenCanvas`** is step 7 (so the UI doesn't jank).

---

## 5. Code sketches

> Illustrative, not final. Names are placeholders (clean-room — see [PRD §15](PRD.md#15-risks--open-questions)).

**Composition config + the pure draw function**
```ts
// composition.ts
export const meta = { width: 1280, height: 720, fps: 30, durationInFrames: 150 }; // 5s

export function drawFrame(ctx: CanvasRenderingContext2D, n: number, m = meta) {
  const t = n / m.fps;                       // seconds — derived from n only
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, m.width, m.height);

  const x = m.width / 2 + Math.cos(t * 2) * 300;
  const y = m.height / 2 + Math.sin(t * 2) * 150;
  ctx.fillStyle = "#3bd0a0";
  ctx.beginPath(); ctx.arc(x, y, 60, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#e6edf3";
  ctx.font = "700 48px system-ui, sans-serif";
  ctx.fillText(`frame ${n}`, 48, 80);
}
```

**Preview (React) — the slider drives the same draw**
```tsx
function Preview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    drawFrame(ctx, frame);                    // no rAF — deterministic
  }, [frame]);
  return (
    <>
      <canvas ref={ref} width={meta.width} height={meta.height} />
      <input type="range" min={0} max={meta.durationInFrames - 1}
             value={frame} onChange={(e) => setFrame(+e.target.value)} />
    </>
  );
}
```

**Render loop + encoder + muxer** (`mp4-muxer` — purpose-built for muxing WebCodecs chunks)
```ts
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

async function render(m = meta): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(m.width, m.height);
  const ctx = canvas.getContext("2d")!;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: m.width, height: m.height },
    fastStart: "in-memory",
  });
  const encoder = new VideoEncoder({
    output: (chunk, md) => muxer.addVideoChunk(chunk, md),
    error: (e) => console.error(e),
  });
  encoder.configure({
    codec: "avc1.4d0028",            // H.264 main@4.0 — adjust per resolution
    width: m.width, height: m.height,
    bitrate: 8_000_000, framerate: m.fps,
  });

  for (let n = 0; n < m.durationInFrames; n++) {
    drawFrame(ctx as unknown as CanvasRenderingContext2D, n, m);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((n * 1e6) / m.fps),   // microseconds
      duration: Math.round(1e6 / m.fps),
    });
    encoder.encode(frame, { keyFrame: n % m.fps === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0)); // backpressure
  }
  await encoder.flush();
  muxer.finalize();
  return muxer.target.buffer;
}
```

**Write to disk** (must be inside a click handler — user gesture required)
```ts
async function save(buffer: ArrayBuffer) {
  const handle = await window.showSaveFilePicker({
    suggestedName: "framediff-m0.mp4",
    types: [{ description: "MP4", accept: { "video/mp4": [".mp4"] } }],
  });
  const w = await handle.createWritable();
  await w.write(buffer);
  await w.close();
}
```

**Determinism harness**
```ts
async function hashFrame(n: number, m = meta): Promise<string> {
  const c = new OffscreenCanvas(m.width, m.height);
  const ctx = c.getContext("2d")!;
  drawFrame(ctx as unknown as CanvasRenderingContext2D, n, m);
  const { data } = ctx.getImageData(0, 0, m.width, m.height);
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Acceptance: hashFrame(75) === hashFrame(75) across reruns AND a page reload.
```

---

## 6. Acceptance criteria

M0 is **done** when, in a Chromium browser:

1. **Renders & plays.** Clicking *Render* produces a `framediff-m0.mp4` (1280×720, 30fps, 5s) that plays correctly in VLC/QuickTime/Chrome.
2. **Determinism (pre-encode).** `hashFrame(75)` is identical across two render runs *and* a page reload. A 3-frame spot check (e.g. 0, 75, 149) all match.
3. **Preview = export.** The preview at frame 75 is visually identical to frame 75 of the exported video. (Bonus: pre-encode pixel hashes match.)
4. **Local write.** The file lands at a user-chosen path via File System Access (no download-blob fallback).
5. **Off-main-thread (step 7).** The render runs in a Worker with `OffscreenCanvas`; the slider stays responsive during a render.

A short `FINDINGS.md` captures: did it hold? what broke? measured frames/sec? any determinism leaks?

---

## 7. Build order

1. Scaffold **Vite + React + TS**; add `mp4-muxer`.
2. `composition.ts`: `meta` + `drawFrame`.
3. Preview: canvas + slider (criteria 3).
4. Render loop on **main thread** + encoder + muxer → `ArrayBuffer` (criteria 1).
5. `save()` via File System Access (criteria 4).
6. Determinism harness + a dev panel button (criteria 2).
7. Move render into **Worker + `OffscreenCanvas`** (criteria 5).
8. *(Stretch)* Swap `drawFrame` for a **WebGPU** pass rendering to the canvas — validates GPU determinism + capture early.
9. *(Stretch)* Composite **one** HTML/CSS overlay via `html-to-image` — feel the DOM-capture fidelity/perf problem before M2 commits to an approach.

---

## 8. Risks & gotchas

- **Encoder backpressure.** Don't out-run the encoder; gate on `encodeQueueSize` (long clips OOM otherwise).
- **Color/alpha mismatches.** Canvas premultiplied alpha vs `VideoFrame` color space can shift colors; verify with a known swatch.
- **`VideoEncoder` determinism.** Encoded H.264 bytes may vary by HW/SW encoder → that's why criteria 2 hashes *pre-encode pixels*, not the mp4.
- **User-gesture rule.** `showSaveFilePicker` must be called from a click; can't auto-save at render end without one.
- **Chromium-only.** File System Access + full WebCodecs assume Chromium (Chrome/Edge/Brave/Arc). Expected per PRD §11.3.
- **Fonts.** System-font text → cross-machine pixel drift; same-machine is deterministic. Embed a webfont later for cross-machine.
- **Codec string.** `avc1.4d0028` is one valid profile/level; may need adjusting for resolution/bitrate.

---

## 9. Thrown away after M0

The hardcoded `drawFrame`, the ad-hoc render button, the inline encoder wiring. M1 replaces `drawFrame` with the **React blessed-component API** ([PRD §9.2](PRD.md#92-authoring-layer-the-blessed-component-api--framework-decision)) and the loop with a reusable renderer the headless CLI also calls.

## 10. What M0 unblocks

- **M1 — core loop:** the renderer + a real composition format the UI/sync engine can target.
- **M2 — effects/overlays/audio:** the stretch goals (WebGPU pass, DOM-overlay capture) directly inform the two-tier compositor and the headless-vs-in-tab capture decision.

---

## Appendix — deps & run

```
npm create vite@latest framediff-m0 -- --template react-ts
cd framediff-m0 && npm i mp4-muxer && npm run dev
# open in Chrome → scrub the slider → click Render → choose a save location → play the .mp4
# determinism: call hashFrame(75) twice in the console; reload; call again — all equal.
```
