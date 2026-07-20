# Demo — recreating a LightTwist brand reel in FrameDiff

> **Goal:** reproduce `lt-marketing/out/hero-with-lower-third/hero-with-lower-third.mp4` in FrameDiff,
> from the LightTwist footage, to exercise the framework on a real marketing video.
> **Lives in:** [`examples/hero-lower-third`](../examples/hero-lower-third). **Status:** built + verified
> (preview and export).

---

## 1. The original, and how it's built

The reference video (1920×1080, 23.976fps, 45.5s, H.264 + stereo AAC) is a two-stage pipeline:

1. **After Effects** (`LightTwist PROJECT.aep`) composes ~15 footage clips and applies a **Lumetri
   color grade + an "Apply Color LUT"** on adjustment layers, exporting a graded `hero.mp4`.
2. **Remotion** (`HeroWithLowerThird.tsx`) plays `hero.mp4` full-frame and overlays an animated
   **lower-third** and a **end card**, plus a `shine` sting.

FrameDiff does the whole thing in **one composition** — including the grade, in-engine.

### Recreation recipe (reverse-engineered design values)

**Canvas:** 1920×1080, black bg. (We use 24fps vs the original's 23.976 — ≈0.5% shorter, imperceptible.)

**Hero grade** (AE Lumetri Basic Correction → our `GradedVideo` params):

| Lumetri | value | `GradeParams` |
|---|---|---|
| Temperature | +20 | `temperature: 0.2` |
| Tint | +10 | `tint: 0.1` |
| Contrast | −20 | `contrast: -0.2` |
| Highlights | −10 | `highlights: -0.1` |
| Shadows | +10 | `shadows: 0.1` |
| Saturation | ~neutral | `saturation: 1.04` |
| Vignette | on | `vignette: 0.32` |

**Lower-third** (frames ~180–348): dark glass bar — `rgba(10,10,15,0.55)`, `backdrop-filter: blur(18px)
saturate(150%)`, 1px `rgba(255,255,255,0.12)` border, 14px radius, `0 24px 70px rgba(0,0,0,0.55)`
shadow, 20×46 padding. Text "Rendered in realtime at 1080p at 30 FPS in **LightTwist**" (SF Pro
Display 700, 40px, white, ls 0.3, lh 1.1, `0 2px 14px rgba(0,0,0,.5)` shadow). Underline: 4px / 2px
radius, 90° gradient `#a29bfe → #6c5ce7 → #fd79a8`, glow `0 0 16px #6c5ce7aa`. Centered, 110px from
bottom. Entrance: fade/blur(6→0)/rise(−38→0) over ~14f (cubic-out); underline springs in (delay 3f,
overshoot). Exit: cubic-in fade + +26px drift over the last 11f.

**End card** (last ~6s, crossfades in over 18f): base `#05060a`, drifting aurora glows (violet
`#6c5ce7` + pink `#fd79a8`), 54 twinkling particles, 6 soft bokeh orbs, inset vignette. CTA: "Get
your studio up and running today at" (SF Pro 600, 46px) + "**lighttwist.com**" (800, 84px, pulsing
`#6c5ce7` glow), 360×5 gradient underline. Lines + underline spring in, staggered.

**Audio:** a music bed (`music.m4a`) throughout + `shine.wav` on the end card.

**Palette:** white `#ffffff`, accent `#6c5ce7`, accent-light `#a29bfe`, accent-warm `#fd79a8`.

---

## 2. What stage of the plan this needed

Per [COMPOSITION-GRAPH.md](COMPOSITION-GRAPH.md) §8, this is a **flat** composition — sequenced clips
+ overlays + a grade. It does **not** need the build graph (P0–P3: precomps / CAS / generators). The
one framework piece it needs is the **P4 effect/color tier** — a frame-tier WGSL grade on the
footage. So we built P4's grade slice on today's core; everything else is composition code.

| Need | Source |
|---|---|
| Sequenced hero clips, DOM overlays, audio mix | existing FrameDiff (`Sequence`, `AbsoluteFill`, `Audio`) |
| Spring animations (lower-third / end card) | **new:** `spring()` primitive |
| Color grade / LUT on the footage | **new (P4):** `GradedVideo` / `createGradeRenderer` |
| Build graph, precomps, generators (P0–P3, P5+) | **not needed** for this demo |

---

## 3. What was built

**Library (`packages/framediff`):**

- **`effects/grade.ts` — `createGradeRenderer`.** A WGSL fullscreen pass that samples a source frame
  as a texture and applies a Lumetri-style grade (white balance, exposure, contrast,
  highlights/shadows, saturation, vignette). Same WebGPU device + `copyTextureToBuffer` readback as
  `webgpuTRex`, so the exporter bakes the exact graded frame deterministically.
- **`effects/GradedVideo.tsx`.** A `<Video>`-like layer with the grade baked in. **Preview** samples
  an off-DOM `<video>` (appended to `<body>`, so it never leaks into the rasterized output) seeked to
  the playhead; **export** decodes the exact frame via MediaBunny (`videoFrames.frameCanvas`, added
  here) and bakes it through the `data-framediff-webgpu` + `__framediffCapture` seam.
- **`spring()`.** A deterministic, frame-driven spring (fixed 1/600s sub-step so it stays stable for
  stiff/over-damped configs).

**Example (`examples/hero-lower-third`):** `GradedVideo` hero sequence (`LIGHTTWIST_GRADE`),
`LowerThird`, `EndCard`, the `MyVideo` orchestration, audio, and the brand constants.

---

## 4. Verified

- **Preview** (Chromium, WebGPU): graded hero, lower-third, and end card all render correctly.
- **Export:** a short low-res `exportVideo` run produced a valid MP4 — the **graded hero baked in**
  (vignette + warm tone visible) with **audio muxed**. DOM-overlay-over-WebGPU compositing + audio is
  already proven by the T-rex demo, so the full composite holds.

## 5. Run / render

```sh
npm install
npm run dev --workspace examples/hero-lower-third   # scrub the preview
```

Then pick a resolution in the top bar and hit **⏺ Render** for the full MP4 (the assets are
gitignored licensed footage — regenerate them with the command in the example's README first).

## 6. Known gaps / next

- **LUT.** The grade is the Lumetri *Basic Correction* math; the original's *creative* `.cube` LUT
  wasn't on disk. `grade.ts` is structured to add a 3D-LUT texture sample (P4's `.cube` path) next.
- **`backdrop-filter`** (lower-third glass) renders in preview; html-to-image's foreignObject raster
  may not blur the footage behind it in export (the bar stays a flat dark glass — still reads fine).
- **23.976fps / crossfades / exact clip choreography** were simplified vs the 45.5s original; the
  goal was a faithful *recreation of the structure + look*, not a byte match.
