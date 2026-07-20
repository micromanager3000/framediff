# Plan — comp-in-comp for real: clipping, local cache, and the hero rebuild

> **Date:** 2026-07-03 · **Status:** implementation plan (executed same day)
> **Goal:** (1) nested compositions as a working library feature — placed, **clipped** (child
> in-point), previewed and exported; (2) derived outputs cached in a **local folder** (no backend);
> (3) `examples/hero-lower-third` rebuilt to match
> `lt-marketing/out/hero-with-lower-third/hero-with-lower-third.mp4` as close to pixel-perfect as
> possible.

## 1. The design (proven in `prototypes/nested-comps`)

**Clipping a nested comp** = three numbers on the *instance*: `from` (placement in parent), `dur`
(window length), `offset` (the child's in-point). UX: left-edge grip slips the in-point
(from/dur/offset move together — content stays locked to parent time); right edge trims, clamped to
`child.dur − offset`; a **miniwin strip** on the clip shows which window of the child is used; and
inside the child, the ruler shows a **use-band per referencing parent** ("sc08 uses 0:08–0:18") —
clipping is legible from both sides. Timeline: sticky ruler; the playhead is a head in the ruler +
full-height body, both draggable.

## 2. Library work (`packages/framediff`)

1. **`<Nested>` — frame-phase nested composition.** Renders another `CompositionConfig` inline:
   remaps the frame (`childFrame = parentLocalFrame · childFps/parentFps + trimStartFrames`,
   clamped to the child's duration), provides the child's `VideoConfig`, and scale-to-fits the
   child's canvas into the parent box. Window the placement with the existing `<Sequence>`.
   Because the whole thing is one DOM tree, `<Video>`/`<Audio>`/WebGPU layers inside the child
   flow through the exporter's existing capture/mix seams untouched — nesting needs **no render-
   pipeline changes**.
2. **Per-frame audio volume.** `buildAudioClips` currently keeps one gain per contiguous run, so a
   Remotion-style `volume={(f)=>…}` fade is dropped. Fix: split runs when the sampled volume
   changes → per-frame gain steps, exactly Remotion's evaluation model. (Needed for the hero's
   24-frame audio fade-out.)
3. **Remotion-parity springs.** Port Remotion's spring semantics (`durationInFrames` stretch via
   measured natural duration, `delay`, default stiffness 100) so the lower-third/end-card motion
   can match frame-for-frame — read the exact algorithm from `lt-marketing/node_modules/remotion`.
4. **Ranged export.** `exportVideo` gains `startFrame`/`endFrame` so the compare loop can render
   30-frame windows instead of 1091 frames per iteration.
5. **Local-folder cache.** `HttpFolderCAS` (implements the existing `CAS` interface over
   `GET/HEAD/PUT /__framediff-cache/<hash>`) + a tiny vite dev middleware that persists bytes to
   `.framediff-cache/` in the example folder. Baked nested comps (P3 `createPrecompBaker` — already
   built) land as real files on disk and survive reloads; a dev "bake" button in the example
   exercises it. No backend, no API keys.

## 3. The rebuild (`examples/hero-lower-third`)

**Target:** 1920×1080 @ **23.976** (24000/1001 — the encoder already takes fractional fps), 1091
frames: hero footage 0–971, lower-third 180–348, end card 953–1091, shine.wav @0.8 from 953, hero
audio fades 947→971.

**Two hero sources, honestly labeled:**
- `HeroFootage` — plays **`hero.mp4`** (the After Effects render lt-marketing composited; its AAC
  is extracted to `hero-audio.m4a` for the mixer). This is the pixel-perfect base: the AE stage's
  bytes pass through 1:1.
- `HeroRebuilt` — the previous session's from-raw-footage recreation (GradedVideo +
  `LIGHTTWIST_GRADE`). The AEP holds **36 Lumetri instances with embedded LUT blobs** (no on-disk
  .cube), so this path stays an approximation of the AE stage — kept as the switchable alternate.

**Structure = comp-in-comp:** `Main` nests `HeroFootage`, `LowerThirdComp`, and `EndCardComp` as
compositions (placed + windowed); a bonus `HeroExcerpt` comp nests `HeroFootage` with
`trimStart` to exercise clipping on the real engine. Overlays ported **value-for-value** from
`lt-marketing/src` (springs, easings, rand(), colors, font stack).

**Compare loop:** render via the browser pipeline (playwright drives the dev server; a dev-only
`window.__renderRange` posts the MP4 to the vite middleware, which writes `out/`); ffmpeg extracts
frames from both videos; per-frame diff (PSNR/SSIM + visual spot-checks at the lower-third
entrance, mid-hero, end-card) → iterate values until the deltas are noise (encode-level).

**Known irreducibles:** H.264 re-encode noise; font rasterization (same macOS Chrome as the
original Remotion render, so SF Pro resolves identically); `backdrop-filter` blur sampling.
Everything structural (timing, layout, motion, colors) should hit exactly.

## 4. Order

prototype UX (done) → this doc → library (§2, with tests) → example rebuild (§3) → compare loop →
commit each stage.
