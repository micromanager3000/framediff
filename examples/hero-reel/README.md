# FrameDiff example · LightTwist reel

The full **LightTwist brand reel** rebuilt in FrameDiff from [`docs/HERO-REEL-SPEC.md`](../../docs/HERO-REEL-SPEC.md)
— the spec extracted from the original After Effects + Remotion project. One FrameDiff composition:

- **The footage edit** ([`edl.ts`](src/data/edl.ts)) — the EDL straight from the AE `LightTwist` comp: each
  shot's source clip + source-in + timing.
- **The look** — every shot is color-graded by the library's WGSL effect (`GradedVideo`): the Lumetri
  grade + the warm **"gold rush" LUT** (the framework's P4 effect tier; the original's `SL GOLD RUSH
  LDR.itx` lives on the editor's drive, so this uses the built-in `lut="gold"`).
- **In-scene captions**, the **lower-third**, a **logo bumper**, the **closing line**, and the
  **end card** — all DOM/CSS + `spring()`.
- **Audio** — the music bed + `shine` / logo-reveal stings.

```sh
npm install
npm run dev --workspace examples/hero-reel   # scrub the reel; ⏺ Render for the MP4
```

## Faithful, not frame-exact

The shot order, source clips, captions, grade, and structure follow the spec. The two AE 3D-camera
interface shots render faux-3D to match — one **corner-pinned** (`VideoPlane`), one on a **real 3D
plane through a perspective camera** (`VideoPlane3D`). A couple of simplifications remain: the 3D
extruded-glass logo bumper is a title card (that needs the glTF `render3d` path, still deferred), and
timing is at 24fps vs the original's 23.976. The point is the framework producing this class of video
end-to-end.

Assets (clip proxies + audio) are **gitignored** (licensed footage) — regenerate them with the
transcode block from the spec / the first demo's README, pointed at the LightTwist footage folder.

## Source organization

- [`src/compositions/LightTwistReel.html`](src/compositions/LightTwistReel.html) owns the edit/content.
- [`src/compositions/LightTwistReel.ts`](src/compositions/LightTwistReel.ts) defines the composition.
- [`src/effects/lightTwistFinish.ts`](src/effects/lightTwistFinish.ts) is a small project preset over
  packaged grade and 3D-plane effects.
- [`src/data/`](src/data) owns the project EDL and brand constants.
- `src/config.ts` only registers the composition.
