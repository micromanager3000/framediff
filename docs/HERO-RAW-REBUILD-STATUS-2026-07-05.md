# Hero raw rebuild status - 2026-07-05

## What changed

- The final comparison video at `lt-marketing/out/hero-with-lower-third/hero-with-lower-third.mp4`
  is no longer the default hero input. `Main` now nests `HeroRaw` by default.
- Raw files from `/path/to/raw-footage` are imported into `examples/hero-lower-third/framediff.assets.json`.
- Because browser/WebCodecs cannot reliably decode the original HEVC, ProRes, and 4:2:2 H.264
  sources, the render EDL points at cached H.264 proxies generated only from the raw footage by
  `examples/hero-lower-third/scripts/make-proxies.sh`.
- `GradedVideo`, `VideoPlane`, and `VideoPlane3D` now support `asset://` refs, so graded and
  corner-pinned AE-style shots can come from the asset cache.
- Export/capture now runs effect layers in capture mode, so preview-only `<video>` elements do not
  interfere with deterministic frame capture.
- WebGPU/effect capture failures now throw instead of silently producing black frames.
- Hardware encoding defaults to `prefer-hardware`; use `prefer-software` when byte-identical codec
  output matters.

## Verified

- `npm run typecheck --workspaces --if-present`
- `npm test`
- Dev server is running at `http://127.0.0.1:5173/`
- Short exports:
  - `examples/hero-lower-third/out/probe-main-0-48-proxy-cache.mp4`
  - `examples/hero-lower-third/out/probe-hero-raw-660-676-proxy-cache.mp4`
- Both short exports contain nonblank 1920x1080 H.264 video and AAC audio.
- Audio level checks:
  - main 0-48: mean `-20.6 dB`, max `-8.6 dB`
  - proxy section 660-676: mean `-17.3 dB`, max `-2.9 dB`

## Remaining visual parity gaps

- The AE 3D camera shots are still approximated with fitted corner pins, not a full import of AE
  camera, plane, and precomp properties.
- The logo bumper is still code-built glass text plus flare, not a full AE logo comp extraction.
- The fitted LUTs approximate the unavailable `SL GOLD RUSH LDR.itx`; exact color parity needs the
  original LUT or a better recovered LUT.
- AE scripting is now unblocked. A fresh dump from the open project exists at
  `examples/hero-lower-third/out/aep-dump.json`; a compact source-in/camera summary is in
  `docs/HERO-AEP-EXTRACT-2026-07-05.md`.

## Next plan

1. Reconcile `src/data/heroEdl.ts` against the exact source-in values in
   `docs/HERO-AEP-EXTRACT-2026-07-05.md`; the current EDL still uses fitted proxy trims for several shots.
2. Map the dumped camera/null/plane transforms into FrameDiff `VideoPlane3D` or a richer AE-camera effect.
3. Replace hand-built logo bumper with either a true code 3D logo scene or a raw-derived AE subcomp proxy.
4. Add a comparison harness that renders fixed frame windows and reports PSNR/SSIM against the final
   comparison video without ever using that comparison as an input.
5. Promote the background render plan in `docs/PLAN-BACKGROUND-RENDER-WORKFLOW-2026-07-05.md` into
   a first implementation pass: browser render job API, then Rust `framediff-render` host.
