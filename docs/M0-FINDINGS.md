# M0 findings

> Measured results from the M0 spike (the plan is [M0-SPIKE.md](M0-SPIKE.md)). The spike's
> throwaway POC app is superseded by the [`framediff`](../packages/framediff) library and lives on
> in git history; these findings shaped its render pipeline.

**Verdict: the hypothesis holds.** A composition expressed as a pure function of the frame
number renders frame-by-frame to a valid MP4 via WebCodecs entirely in the browser,
deterministically, with the preview driven by the same function as the export. Verified in
Chromium on 2026-06-23.

## Results

| Check | Result |
| --- | --- |
| Determinism — pre-encode pixels, frames 0/75/149, hashed 3× | ✅ identical every time |
| WebCodecs H.264 `avc1.4d0028` support | ✅ supported |
| Full 150-frame encode | ✅ 930 KB MP4, no errors |
| Render throughput (main thread, 720p) | ~214 fps (150 frames in ~700 ms) |
| Output validity (ffprobe) | ✅ h264 / yuv420p / 1280×720 / 30 fps / 150 frames / 5.000 s |
| Preview = export | ✅ same `drawFrame` drives both |

Frame-75 pixel hash, stable across runs and reloads: `0d30985ac4db47a4`.

## Still needs a human (real user gesture — can't be automated)
- [ ] Save-to-disk via `showSaveFilePicker` — the native save dialog requires a genuine click.

## Not done yet (next step toward criterion #5)
- Off-main-thread render (Web Worker + `OffscreenCanvas`). Currently main-thread; fine at this
  scale (~700 ms) but will jank the UI on longer compositions.

## Notes / gotchas surfaced
- `mp4-muxer` works but is npm-deprecated in favor of **Mediabunny** — candidate swap later.
- Determinism is intentionally checked on *pre-encode pixels*; encoded H.264 bytes may differ
  across machines/encoders (expected, not a regression).
- Canvas2D text uses system fonts → cross-machine pixel drift is possible; same-machine is
  stable. Embed a webfont when cross-machine reproducibility matters.
- Headless Chromium (Playwright) *did* support WebCodecs H.264 encode — not guaranteed
  everywhere, but handy for a future CI determinism gate.

## Encoder fidelity — H.264 mangles low-contrast detail (found via the grid)

The faint background grid (1px white at 4% opacity over near-black `#0b0f14`) shimmers and blocks
in the encoded video, even though the source draws it pixel-identically every frame. Confirmed by
comparing the lossless source frame against the decoded video frame (same crop, brightness-
amplified): the source is pristine; the H.264 frame shows DCT macroblocking on the flat dark area,
smeared/doubled grid lines, green/red chroma fringing at intersections, and frame-to-frame flicker
(the static grid is re-quantized differently each frame).

Root cause — a near worst case for H.264:
- The grid's luma delta is ~10/255, right at the quantization floor.
- 4:2:0 chroma subsampling → colored fringing on thin lines/edges.
- DCT block quantization on flat dark regions → blocking.
- P-frame prediction re-quantizes static detail each frame → temporal shimmer.

**Does not affect the M0 verdict:** determinism is checked on *pre-encode* pixels (the source is
perfect), which is why the hash check passed. But it's a real product signal — the encode is a
lossy stage, and subtle gradients / thin lines / dark flats are exactly where it shows.

Fix path (product, not spike):
- Higher bitrate + constant rate control (helps; can't fully recover sub-threshold detail).
- Better codecs: VP9/AV1 handle low-contrast & flat areas far better (AV1 especially).
- 10-bit encoding to kill dark-gradient banding; 4:4:4 for crisp colored lines/text.
- Visually-lossless intermediate codecs (ProRes/DNxHR) via the cloud tier (server ffmpeg).

### AV1 vs H.264 — measured (same 8 Mbps target, 150 frames, 720p30)

| | H.264 (`avc1.4d0028`) | AV1 (`av01.0.04M.08`) |
| --- | --- | --- |
| File size | 931 KB (1.49 Mbps actual) | 414 KB (662 Kbps actual) |
| Encode time (this Mac) | ~700 ms | ~388 ms |
| Static-grid flicker (frame-to-frame diff) | heavy — whole grid shimmers | ~none — diff is black |
| Amplified grid stills | smeared/doubled lines, macroblock blotches, chroma fringing | close to source; crisp lines, uniform cells; minor faint streaking |

**AV1 wins decisively here** — better quality, ~half the bitrate, faster encode, all in-browser
via WebCodecs. Strategy: default to **AV1 where supported** (free/local tier), fall back to H.264
for compatibility, reserve ProRes/pro codecs for the cloud tier. Residual faint banding in the
ultra-flat dark area persists in both (8-bit 4:2:0 floor) — needs higher bitrate / 10-bit / an
intermediate codec. The spike's renderer is now codec-configurable (`render({ codec, muxerCodec })`).

### Color-range mismatch — a real preview≠export gap

Both encodes are tagged `color_range=tv` (limited, 16–235) while the canvas is **full-range**
(0–255), so exported blacks are lifted / whites lowered vs the live preview — a subtle but real
violation of "preview = render," and part of why the dark background shifted under amplification.
Fix: signal full range to the encoder (e.g. a `VideoFrame` `VideoColorSpace` with `fullRange: true`)
or handle the conversion. Tracked for the M1 renderer.
