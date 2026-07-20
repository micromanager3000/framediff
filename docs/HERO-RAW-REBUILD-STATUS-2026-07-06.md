# Hero raw rebuild status — 2026-07-06

The rebuild is now **AEP-exact**: every cut, source-in, layer motion, caption window and 3D
camera move derives from the checked-in ground truth `examples/hero-lower-third/ae/aep-dump.json`
via `scripts/derive-from-aep.ts` → `src/data/heroAep.gen.ts` (plain literals — Studio-editable,
regenerable). The reference render stays output-test-only.

## What the AEP dump settled (vs the old NCC-fitted EDL)

- **cam4/cam6 showed the wrong footage moments**: NCC had locked onto lookalike UI screens at
  497 s / 576 s of the 19-minute explicacao recording; the AEP says 736.65 s / 187.49 s.
  Proxies re-cut, stable `proxy-*` asset ids updated in place by `scripts/sync-proxies.mjs`.
- **Playback rates**: stretch is only on two layers (open ×0.9, tripod_b ×1.2346 — the AE
  `sourceTime = (t − startTime) · 100/stretch` mapping is unit-tested). The NCC rates of
  0.038/0.527/2.26 on blazer/desk/magnific were fit noise; they are 1.0.
- **Boundary rule**: AE shows a layer at frame N iff `inPoint ≤ N/fps`; in-points sit ~1e-5 s
  under integer frame boundaries, so `ceil(in·fps − ε)`. Verified against six reference cuts.
- **The reference composite is one frame late**: reference mp4 frame M shows comp frame M−1
  (verified at every checked cut). All comparisons apply `REF_OFFSET = 1`.
- **Divergent Desktop sources** (re-renders that don't match the AEP's copies): the four
  `latest2*` clips (other fps/height/duration) and kling-gerar (its wide→closeup cut happens
  4 frames earlier). These carry measured fits in `heroEdl.ts` (`DIVERGENT_FITS`, `FIT_SCALE`,
  `FIT_PATHS`) produced by `scripts/analysis/fitpane.py`.

## Library additions

- `framediff/ae` (`aeImport.ts`): dumped-property evaluation (LINEAR/HOLD/default-BEZIER — which
  is exactly smoothstep), source-time mapping, visibility-resolved cut recovery, and
  AE-camera+plane → plane-relative world-unit conversion. 12 unit tests, including the
  identity-framing case (resting AE camera + comp-filling plane ⇒ plane exactly fills the FOV).
- `VideoPlane3D`: `cameraKeyframes` (AE-eased; key frames may lie outside the clip so a cut
  plays the same mid-motion slice AE rendered), `focusDistance`, `planeSize` (non-16:9 planes),
  `dofModel="thinLens"` (physical |1/f − 1/d| CoC in scene3d; legacy linear model untouched).
- Studio `CameraPanel` understands keyframed rows (`startFrame/endFrame/planeW/planeH`).

## Library bug the case study caught

`exportVideo`'s video/WebGPU stand-ins copied only `object-fit`, so any blended or faded video
baked wrong in exports — the bumper's screened flare rendered the whole shot black, while
single-frame probes (captureCompositeFrame, which had the styles fix) looked perfect. The
stand-in creation is now shared (`render/standIn.ts`) and inherits computed
opacity/mix-blend-mode/transform/filter in both paths.

## Verification loop

- `__probe("main", frames)` bakes frames through the real export path;
  `scripts/analysis/compare.py main` scores them (PSNR/NCC per canonical frame + sheets);
  `scripts/analysis/fullcompare.py` scores an entire render per shot;
  `scripts/analysis/fitpane.py` fits divergent-source placements.
- Probe status (NCC): straight cuts 0.96–0.99; split 0.95; keynote_b 0.87; cam6 0.91;
  greenwide/greentrack 0.93; keynote 0.92; grid 0.92.

## Remaining gaps

- The 3D camera shots sit ~0.72–0.91: geometry verified exact at the shots' rest frames, but
  the dump lacks per-key temporal-ease (influence/speed) and mask shapes, so mid-move framing is fitted (intermediate pose keys / influence values measured against
  reference probes); DoF itself is now exact — scene3d renders screen-space depth-of-field
  (color+depth targets → per-pixel CoC gather) so AE's aperture converts with no fudge factor. An enhanced `ae-dump-project.jsx`
  that captures `keyInTemporalEase`/mask vertices would close this properly.
- Cards/bumper are code-matched by eye (bumper wordmark, rise-text cadence) — close, not pixel.
- Keynote pane masks and the grid's animated wipe are approximated (shapes not dumped).
- Grade: fitted LUTs predate the cam4/cam6 re-cuts; a gradefit re-run would tighten color.
