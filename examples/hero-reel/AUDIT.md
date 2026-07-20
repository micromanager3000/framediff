# Hero reel — frame-by-frame audit vs the reference render

Reference: `lt-marketing/out/hero-with-lower-third/hero-with-lower-third.mp4`
(1920×1080, 23.976 fps, 1091 frames, 45.55 s). Our reel: 1920×1080, 24 fps, 1092 frames — so
our frame _n_ maps to reference time _n_/24 s (drift < 1 frame end-to-end).

## Method

Frames are baked through the **real export path** (not preview screenshots) via the library's
`captureCompositeFrame(comp, n, …)` — same per-frame pipeline the encoder runs (deterministic
WebCodecs decode → WGSL grade / 3D plane → DOM raster). A dev hook (`window.__bake`, DEV-only in
`main.ts`) exposes it; the bakes are paired with `ffmpeg`-extracted reference frames at _n_/24 s
and diffed side by side. 17 sample frames across the timeline.

A full continuous 45 s encode is a one-click **Render** in the Studio (~minutes); it is impractical
to drive head-less frame-by-frame, so the audit samples representative frames instead.

## What matches well

- **Opening woman shot** (after the regrade): warm, bright, airy, soft glow + gentle vignette.
- **4-up "Monday morning meeting" grid** (~f110): colour + content track closely.
- **Newsroom host + lower-third** (~f190): framing, lower-third text/box/underline align.
- **"switch cameras" keynote** (~f530), **keynote "Arc" slide** (~f700), **newsroom desk** (~f810).
- **Closing "Your studio. Anywhere."** (~f920) and **`lighttwist.com` end card** (~f1020).

## Fixed in this pass

1. **Grade** was too dark / saturated / heavy-vignette vs the luminous reference. Re-tuned global
   `GRADE` brighter + airier (exposure −0.03→+0.03, vignette 0.6→0.34, shadows un-crushed, sat
   1.08→1.05). Added a per-shot override so the **woman open** gets the extra glow + soft vignette
   the reference leans on ("especially on the woman").
2. **Closing card**: was heavy-bold, left, on flat black → now lighter weight, centred, on a navy
   gradient, matching the reference's refined type.
3. **Captions**: bumped size (62→68) and raised slightly to sit in the lower third.
4. **3D interface shots** now carry the same grade + LUT + bloom + vignette as the rest (prior pass).

## Known remaining gaps

- **EDL timing drift (middle ~10–32 s).** Beats lock at f110 / f190 / f530 / f700 / f810 / f920 /
  f1020, but between them shot **durations differ from the reference cut**, so content slides in and
  out of sync (the newsroom runs longer in the reference; the app-UI / talking-head / "All you need
  is a camera" black-card beats land at different times). Our EDL was derived from the After Effects
  project timings (`docs/HERO-REEL-SPEC.md`), which is a **different cut** than this particular
  render — frame-locking would need the reference's actual edit decision list, not the AE project.
  (`ffmpeg` scene-detection finds ~no hard cuts even at threshold 0.15 — the reference transitions
  are dissolves — so its shot boundaries can't be recovered from the video alone.)
- **Logo bumper**: now a **faux-3D glass wordmark** (gradient fill matching the reference's
  pink/violet→blue/teal direction, extrusion, top gloss, glow) — close to the reference glass logo.
  A true extruded-glass **glTF / `render3d`** render and the **exact brand font** (the stylized
  lowercase "t" swash) remain the deferred tier / need the font file.
- **Woman-shot framing** is marginally tighter/lower than the reference (the AE comp appears to scale
  + offset the 4K source slightly; our proxy is the centred 1:1 frame). Cosmetic.
