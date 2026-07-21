# FrameDiff Production Lab

The Production Lab is the end-to-end acceptance project for FrameDiff's source-backed editor. It is
not a mockup or a reel of prerecorded feature clips: every chapter is a real nested composition, and
every Guide target opens the actual object, frame, timeline lane, source file, or production panel
used by the feature.

## Run it

```sh
npm install
npm run dev --workspace examples/studio-playground
```

Open `http://localhost:5173/?comp=production-lab` (use the port Vite prints if 5173 is occupied).
Studio Playground is the example's default composition; `production-lab` remains directly addressable.

Start with **GUIDE** in the header. Progress is stored locally per guide version. **Start Tour** lands
on the exact composition, frame, object, and panel for each exercise; the guided-task strip keeps the
action visible after Properties or Code takes focus.

## What the overview contains

The 1,788-frame, 30 fps overview is authored in
[`ProductionLab.html`](../examples/studio-playground/src/compositions/labs/ProductionLab.html). Its persistent HUD is an
ordinary `onFrame` callback, so jumping straight to any frame updates the chapter label and progress
without playing through the intervening frames.

| Frames | Real nested chapter | What it proves |
| --- | --- | --- |
| 0–179 | Production graph + pinned generated take | HTML/CSS, image/video assets, gradients, blend, frame-authored HUD |
| 180–359 | `DirectManipulationLab` | Stable canvas selection, move/resize, constraints, computed-geometry materialization |
| 360–539 | `RichPropertiesLab` | Text, typography, color, gradients, image fills, flex, spacing, opacity, blend/isolation |
| 540–719 | `EditorialLab` | Source-backed lanes, stacking, real media front trims, proxy/content provenance |
| 720–899 | `GsapMotionLab` | Frame-authored GSAP, keys/eases, curves, auto-key, arc paths, gesture recording, unroll |
| 900–1187 | `GradeLab` | Browser-local color grade, LUT processing, exact bypass comparison |
| 1188–1427 | `HeroWithLowerThird` | Legacy nested production, raw-derived footage, trims, overlays, audio, effects |
| 1428–1607 | `HeroPlane3D.uizoom` | Imported AE camera authority, 3D video plane, depth of field, motion blur, LUT |
| 1608–1787 | `EndCard` | Legacy authored cards, animation, audio and local delivery |

A real audio asset spans the complete overview on A1, while the frame-driven HUD stays on an explicit
V11 layer. The chapter clips use source-declared nesting and real `trimStart`; the Studio does not
special-case the showcase.

## Guided acceptance tour

The source-declared guide lives in
[`ProductionLabGuide.ts`](../examples/studio-playground/src/compositions/labs/ProductionLabGuide.ts). Its 17 workflows
cover the feature set as one production journey:

1. Random-access scrub of the complete production graph.
2. Canvas selection, move/resize, constraints, Undo and source persistence.
3. Explicit materialization of computed geometry.
4. Direct text editing and typed typography controls.
5. Gradients, image fills, flex, spacing, opacity and blend controls.
6. Portable asset identity, originals, proxies and content hashes.
7. Real-media front trimming with atomic Undo/Redo.
8. Persistent visual lane movement and stacking.
9. Frame-authored GSAP tween, key, value and ease editing.
10. Arc-motion handles and frame-sampled gesture recording.
11. Safe computed-helper rewriting through **Unroll to edit**.
12. Grade/LUT editing, B-key bypass and exact capture.
13. Imported 3D camera with a dedicated lens/FOV, endpoint-pose, focus/DOF, plane and motion-blur Inspector.
14. A pinned generative take and non-spending draft/stale workflow.
15. The first-class `onFrame` escape hatch and source view.
16. Content-addressed bakes, dependency fingerprints and stale state.
17. Agent project check, repeated exact snapshot and browser-local render.

## A useful smoke pass

1. Scrub the overview with Home, End, clicks and arrow keys. The image, chapter HUD, frame number and
   nested composition must agree immediately.
2. Run the Guide's canvas step. Drag once and verify that Undo is one entry, reload preserves the
   source edit, and Redo reapplies it.
3. Select any nested chapter in the overview timeline. Properties should open automatically and show
   asset/rendition hashes, effects, bake status and an **Open nested composition** action.
4. In `EditorialLab`, front-trim the real-media clip and move a visual clip vertically. Undo each
   operation and confirm timing and stacking return together.
5. In `GsapMotionLab`, move a key and jump across it in both directions. Then edit an arc handle,
   preview a gesture, and unroll/undo the helper.
6. In `GradeLab`, click **GRADE ON** or hold B. Capture the graded frame and verify the bypass resets.
7. In `HeroPlane3D.uizoom`, select the clip, switch to **B · END**, change **End focal length**, scrub,
   then Undo. Expand Focus, Video plane and Finishing to confirm the whole shot is source-addressable.
8. Open the pinned `skyTimelapse` generation composition. Editing a draft parameter should mark the
   draft stale; no provider call occurs until **Generate** is pressed.
9. Open Cache and run **AGENT API v1**. A frame snapshot should report its dimensions and SHA-256.
   Capture the same composition/frame again and compare the hashes.
10. Use **Render MP4** for the final local-path check. Preview, LUT/grade, nested comps, media and audio
   use the same browser-local frame clock and capture path.

## Generation cost

The acceptance project deliberately reuses the existing immutable sky take, including its pinned take
number and provider provenance. No new FAL request was needed to make the workflow real, so this work
spent **$0** of the authorized $10. A user can still make an explicit generation request from the
generative composition when they want a new take.

## Why this structure matters

The overview, child labs, source, Inspector, timeline, Guide, agent surface and exporter all identify
the same project objects. That makes the example useful as a regression harness: a feature is not done
when it only has a code API or an isolated UI. It is done when a user can discover it, reach the exact
object, make one source-backed edit, undo it, jump to any frame, and deliver through the local render
path without translating the project into a second format.
