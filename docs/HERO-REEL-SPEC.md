# LightTwist hero reel — generation spec

> A build-ready spec for regenerating `hero-with-lower-third.mp4` **from the raw footage**, in any
> engine (the target is FrameDiff). Every timestamp, source file, trim, caption, color value, and audio
> cue below is taken from authoritative sources — not guessed.

**Sources of truth**

- **After Effects** `LightTwist PROJECT.aep` → comp **`LightTwist`** (1920×1080, **23.976fps**, **40.50s**,
  48 layers). Read via a read-only ExtendScript dump (every layer's `source`, `inPoint`, `outPoint`,
  `startTime`, text). This is the footage edit + grade + in-scene captions, rendered to `hero.mp4`.
- **Remotion** `HeroWithLowerThird.tsx` wraps `hero.mp4` with a lower-third + a 5s end card → the final
  **45.50s** video.
- Scene-cut detection on the render confirmed the cut times.

**Final output:** 1920×1080, 23.976fps, **45.50s** = 40.50s AE framediff + ~5s end card (0.75s crossfade).
H.264 + stereo AAC 48kHz. Background `#000000`.

---

## 1. The look (global grade — applies to ALL footage)

Four comp-level adjustment layers over the whole 40.5s framediff (AE `LightTwist` layers 2–5):

| Stage | Setting |
|---|---|
| **Lumetri — Basic Correction** | Temperature **+20**, Tint **+10**, Saturation neutral, Exposure 0, Contrast **−20**, Highlights **−10**, Shadows **+10**, Whites/Blacks 0 |
| **Lumetri — Creative + Curves + Wheels + HSL + Vignette** | Creative intensity 100; Vignette on (midpoint 50, feather 50) |
| **Apply Color LUT ×2** | **`SL GOLD RUSH LDR.itx`** — a warm golden filmic LUT (applied twice, on two adjustment layers) |
| **Posterize Time** | a frame-rate stylization layer (slight cine cadence) |

Net look: **warm, golden, soft-contrast, lifted-shadow, gently vignetted** — the "SL Gold Rush" cinematic
grade. FrameDiff maps this onto `GradedVideo` (Lumetri math) **+ the `.cube`/`.itx` LUT** once P4's LUT path
lands. The `.itx` LUT lives on the editor's drive (`SL GOLD RUSH LDR.itx`); convert to `.cube` or obtain it
to match exactly, otherwise approximate with a warm-gold LUT.

---

## 2. Footage edit (the 40.5s framediff)

Primary on-screen clip per segment. **t** = position in the final timeline (s). **src-in** = trim into the
source = `inPoint − startTime` from the AE layer. Many cuts are hard; the rapid 25–34s run is a fast framediff.

| # | t (start–end) | Source file | src-in | Notes |
|---|---|---|---|---|
| 1 | 0.00–1.83 | `NANDO_FX3_0023.mp4` | 3.78 | open — raw FX3 studio shot |
| 2 | 1.83–3.8 | `NANDO_FX3_0030.mp4` | 4.90 | raw FX3 |
| 3 | 3.8–6.05 | `stream feio.mp4` (precomp) | — | the "ugly stream" shot (webcam look) |
| 4 | 6.05–10.97 | `latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4` | 5.47 | polished newsroom (the contrast) |
| 5 | 10.97–12.47 | `latest2ar2_lighttwistnewsroom-…mp4` | 13.93 | newsroom |
| 6 | 12.39–14.51 | `latest2ar2_lighttwistnewsroom-…mp4` | 15.48 | newsroom |
| 7 | 14.51–16.93 | `Screen Recording 2026-06-17 at 3.52.13 PM.mov` | 0.00 | 3D-projected screen (AE Camera 7) |
| 8 | 16.93–18.77 | `2026-06-15 17-29-58.mp4` | 28.17 | + AE Camera 3 |
| 9 | 18.64–20.44 | `2026-04-24 13-35-32.mp4` (+ `hf_20260617_193427_…mp4`) | 7.62 | |
| 10 | 20.44–22.56 | `explicacao-interface-nova.mp4` (precomp, Camera 4) | — | 3D interface demo |
| 11 | 21.62–23.94 | `latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4` | 4.58 | keynote (3 stacked layers) |
| 12 | 25.28–26.07 | `hf_20260617_191556_e93008c8-…mp4` | 2.84 | fast framediff begins |
| 13 | 25.98–26.65 | `magnific_video-upscale_3009454435.mp4` | 1.20 | |
| 14 | 26.65–27.69 | `explicacao-interface-nova.mp4` (Camera 6) | — | 3D interface |
| 15 | 27.57–28.90 | `kling_20260527_…gerar_uma…_2957_0_prob4.mov` (+ precomp) | 1.08 | AI clip |
| 16 | 28.90–30.24 | `2026-04-24 13-52-20.mp4` | 45.88 | |
| 17 | 29.99–31.50 | `latest2br1_SmartestPerson_Standalone-2026-05-12-13-47-09.mp4` | 35.16 | |
| 18 | 31.00–32.21 | `kling_20260527_…animar_as…_5514_0_prob4.mov` | — | AI clip |
| 19 | 31.83–33.96 | `2026-04-24 13-57-01.mp4` (2 layers) | 14.13 | |
| 20 | 33.70–35.12 | `latest2ar2_bright-keynote-2026-06-15-16-01-50.mp4` | 11.54 | last live shot |
| 21 | 35.12–37.37 | **Logo bumper** (`Render Comp` → `Main`/`Logo Comp`) | — | 3D extruded glass "LightTwist" logo + flares |
| 22 | 37.37–40.50 | closing text on dark-royal-blue bg | — | "Your studio. Anywhere." |

> Notes: the `Camera 3/4/6/7` layers are AE 3D cameras projecting screen-recordings onto planes (faux-3D
> interface shots). In FrameDiff these are either a static crop or a `cornerPin`/`render3d` plane (P4 §5.6).
> The `*.mov`/precomp entries are AE precomps; the underlying source files are in the footage folder.

---

## 3. In-scene captions (baked into the AE framediff)

White bold text overlays, timed to the footage. Exact content + timing from the AE text layers:

| Text | t (start–end) | Notes |
|---|---|---|
| "Your show looks like a" | 2.71–6.05 | line 1, over the "ugly stream" shot |
| "Monday morning meeting." | 3.62–6.05 | line 2 (staggered in) |
| "live background removal" | 16.29–18.64 | |
| "drop in video and audio" | 20.00–22.23 | |
| "switch cameras" | 21.98–23.94 | |
| "All you need is a camera" | 23.94–25.32 | |
| "Your studio. Anywhere." | 37.37–40.50 | closing line over the logo |

(Style: bold white, large; the exact font/size weren't dumped — match the Remotion lower-third family,
SF Pro Display / -apple-system.)

---

## 4. Remotion overlays (added on top of `hero.mp4` → final 45.5s)

**Lower-third** — t **7.51–14.51** (frames 180–348 @ 23.976): dark glass bar
`rgba(10,10,15,0.55)` + `backdrop-filter: blur(18px) saturate(150%)`, 1px `rgba(255,255,255,0.12)`,
14px radius, `0 24px 70px rgba(0,0,0,.55)`, 20×46 padding. Text "Rendered in realtime at 1080p at 30 FPS
in **LightTwist**" (SF Pro Display 700, 40px, white, ls 0.3, lh 1.1). Underline 4px, 90° `#a29bfe → #6c5ce7
→ #fd79a8`, glow `0 0 16px #6c5ce7aa`. Bottom-centered, 110px from bottom. Enter: blur/opacity/rise spring
over ~14f + underline scaleX spring (delay 3f). Exit: cubic-in fade + +26px over last 11f.

**End card** — t **39.75–45.50** (crossfades over the framediff's last 0.75s): base `#05060a`, drifting
aurora glows (violet `#6c5ce7` + pink `#fd79a8`), 54 twinkling particles, 6 bokeh orbs, inset vignette.
CTA "Get your studio up and running today at" (SF Pro 600, 46px) + "**lighttwist.com**" (800, 84px, pulsing
`#6c5ce7` glow, ls 0.5), 360×5 gradient underline. Lines + underline spring in, staggered.

**Palette:** white `#ffffff`, accent `#6c5ce7`, accent-light `#a29bfe`, accent-warm `#fd79a8`,
end-bg `#05060a`.

---

## 5. Audio

| Track | t (start–end) | Vol | Role |
|---|---|---|---|
| `LightTwist Audio Quente.aac` | 0.00–40.50 | bed | music bed under the whole framediff |
| `shine.wav` | 6.05–11.05 | — | sting on the newsroom reveal |
| `Mountain Audio - Logo Reveal.wav` | 34.79–40.75 | — | logo-bumper reveal |
| `shine.wav` (Remotion) | 39.75–44.75 | 0.8 | end-card sting |
| hero audio | fades out last ~1s | — | embedded clip audio (mostly bed-dominated) |

---

## 6. Asset → file map (LightTwist footage folder)

All under `…/LightTwist (H:V)/(Footage)/arquivos/`. Live shots are raw (FX3 / camera / screen-rec); the
`kling_*`, `magnific_*`, `hf_*` clips are AI-generated; `latest2ar2_*` are LightTwist product renders.
Key files: `NANDO_FX3_0023.mp4`, `NANDO_FX3_0030.mp4`, `stream feio.mp4`,
`latest2ar2_lighttwistnewsroom-2026-06-17-21-40-53.mp4`, `Screen Recording 2026-06-17 at 3.52.13 PM.mov`,
`2026-06-15 17-29-58.mp4`, `2026-04-24 13-35-32.mp4`, `hf_20260617_193427_*.mp4`,
`explicacao-interface-nova.mp4`, `latest2ar2_bright-keynote-2026-06-15-16-12-27.mp4`,
`hf_20260617_191556_*.mp4`, `magnific_video-upscale_3009454435.mp4`,
`kling_20260527_…gerar_uma…_2957_0_prob4.mov`, `2026-04-24 13-52-20.mp4`,
`latest2br1_SmartestPerson_Standalone-2026-05-12-13-47-09.mp4`,
`kling_20260527_…animar_as…_5514_0_prob4.mov`, `2026-04-24 13-57-01.mp4`,
`latest2ar2_bright-keynote-2026-06-15-16-01-50.mp4`. Audio: `LightTwist Audio Quente.aac`, `shine.wav`,
`Mountain Audio - Logo Reveal.wav`.

---

## 7. Building it in FrameDiff (what this needs)

- **Footage edit + captions + lower-third + end card + audio** → existing FrameDiff (`Sequence`, DOM
  overlays, `Audio`, `spring()`).
- **The grade + `SL GOLD RUSH LDR` LUT** → P4 effect tier: `GradedVideo` (Lumetri math, built) **+ the
  `.cube` 3D-LUT sampler** (P4 §5.7, to build).
- **The faux-3D interface shots** (Camera 3/4/6/7 projecting screen-recordings) → P4 `cornerPin`/video-plane,
  or a static crop for a first pass.
- **The logo bumper** (3D extruded glass logo, 35.12–37.37) → `render3d` (P5) or a pre-rendered clip drop-in.
- Per the [composition-graph plan](COMPOSITION-GRAPH.md), the full reel is still a **flat** composition
  (no precomp caching needed) — so it's buildable once P4 (grade + LUT + corner-pin) is complete; the logo
  bumper is the only piece that wants P5/`render3d` (or just drop in the existing rendered bumper).

> Appendix: the raw AE layer dump (exact in/out/start/source for all 48 layers) was captured for reference.
