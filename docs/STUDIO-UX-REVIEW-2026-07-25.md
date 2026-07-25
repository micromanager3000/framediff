# FrameDiff Studio deep UX review — 2026-07-25

This pass compared the live FrameDiff Studio against HyperFrames Studio and exercised the
`StudioPlayground`, `DirectManipulationLab`, and `GsapMotionLab` examples. It focuses on the editor's
interaction model and visual hierarchy rather than the underlying render/runtime feature set.

## Executive conclusion

FrameDiff should keep its composition graph, source-backed Inspector, nested breadcrumbs, and exact
frame model. Those are the product. The opportunity is to reveal that power more selectively.

HyperFrames feels calmer at first because it presents a player-first workspace, keeps its Inspector
optional, uses an explicit timeline tool row, and lets previews do more visual work than labels. It
also has less heterogeneous project structure to explain. Copying its shell wholesale would weaken
FrameDiff's strongest idea: compositions are meaningful project objects, not merely timeline clips.

The right direction is therefore:

1. Keep the FrameDiff composition flow.
2. Make the canvas the visual center of gravity.
3. Treat editing modes as explicit temporary states.
4. Reveal precise/source-level controls after the primary action, not before it.
5. Use color to communicate state and authority, not to tint every surface.

This branch takes the first pass at that direction.

## FrameDiff versus HyperFrames

| Area | FrameDiff today | HyperFrames observed | Product decision |
| --- | --- | --- | --- |
| Project model | Strong nested composition graph, kinds, library, breadcrumbs, and direct nesting | Flatter composition browser with preview thumbnails | Keep FrameDiff's graph; add an optional visual/thumbnail view and folders instead of flattening it |
| First impression | Three persistent regions plus a dense project/action header | Player-first center, optional Inspector, compact global actions | Move FrameDiff toward focusable/collapsible side regions without hiding graph context |
| Canvas editing | Immediate click/drag with stable source authority; modes were mostly implicit | Explicit selection state and a dedicated tool strip | Preserve immediacy, but announce temporary modes and expose tools when they become relevant |
| Timeline | Exact frame lanes, render window, clips, animations, helpers, and authored layers | Clear selection/razor/snap/keyframe/auto-record toolbar and larger time ruler | Adopt explicit tools progressively; do not show unavailable editing concepts just to resemble an NLE |
| Inspector | Very capable, but primary controls and source-level precision often share one long column | Short empty state, task-oriented actions, secondary tabs for deeper state | Make primary intent obvious and collapse precision/detail by default |
| Motion paths | Exact editable Bézier route plus gesture recording, but terminology and recording mode were unclear | Gesture entry is prominent; canvas/tool state is visually explicit | FrameDiff can be better here: explain the route, distinguish curve vs draw, show a canvas mode, and keep precise points optional |
| Diagnostics | Agent check, source authority, Git, cache, and bake state are available but dispersed | Persistent lint count is close to the work surface | Add a compact preflight/diagnostic badge near the composition identity in a later pass |
| Visual system | Warm brown surfaces and gold on almost every level made the shell feel muddy | Neutral near-black shell with one bright green action color | Use neutral graphite surfaces; retain gold as FrameDiff identity and reserve violet/cyan for motion |

## What worked especially well

- **Composition flow is coherent.** The root project, nested chapters, focused leaves, breadcrumbs,
  timeline clips, and Inspector all refer to the same objects. HyperFrames did not suggest a better
  replacement for this.
- **Direct manipulation is honest.** `DirectManipulationLab` makes a canvas drag, JSON authority,
  typed fields, Undo, and HMR feel like one system.
- **Motion is unusually inspectable.** `GsapMotionLab` exposes frame-authored operations, keys, easing,
  a spatial route, and source location without translating to a hidden editor database.
- **The Guide is a meaningful product surface.** It can bridge a large project graph better than
  generic onboarding chrome, as long as the editor remains understandable when the Guide is closed.

## Main issues found

### 1. Too much is equally important

At 1280×720, the brand, breadcrumbs, Git, Guide, Undo, Redo, Services, Cache, refresh, render,
composition rail, canvas controls, timeline summary, Inspector tabs, source authority, easing, path
controls, precise points, and keys all compete in one frame. The capability is impressive, but the
hierarchy does not tell the user what to do next.

The immediate rule should be: one primary action per section, one visible status, and details behind
disclosure. Services, cache, source spans, hashes, and point coordinates remain important, but they
should not visually rival the current edit.

### 2. Temporary modes did not feel like modes

Before this branch, pressing **Record gesture** changed internal behavior and added a small note in the
Inspector. The canvas itself still looked like ordinary selection mode. A user could easily drag the
wrong place, wonder whether recording had started, or miss how to cancel.

Any tool that changes what a canvas drag means must announce itself on the canvas, change the cursor,
show its completion condition, and support Escape.

### 3. Motion-path language assumed motion-design vocabulary

“Spatial path,” “Make arc,” “Anchors + tangents,” and raw `control1`/`control2` fields describe the
implementation. They do not first answer:

- What will move?
- Is this changing timing or only the route?
- What do the solid and hollow points do?
- What is the difference between making an arc and recording a gesture?

The route should be explained visually before numeric Bézier data is shown.

### 4. Valid scenes looked empty

`GsapMotionLab` displayed “No timeline items were discovered” above nine valid motion lanes. That copy
made a functioning, source-driven scene look partially broken. Empty states must describe the model
that is present, not only the model that is absent.

### 5. The visual shell reduced perceived quality

The previous brown-black palette worked as a brand sketch but made separators, panels, muted text,
and preview surround merge together. Gold simultaneously represented brand, focus, selection,
timeline, render window, and many actions. The resulting hierarchy felt older and busier than the
underlying product.

A neutral graphite shell lets the composition carry most of the color. Gold can remain the stable
FrameDiff selection/output color; violet can mean motion; cyan can mean path/camera spatial controls;
green can mean successful/current state.

## Changes made in this branch

- Shifted the shell to neutral graphite surfaces with higher-contrast secondary text.
- Kept gold as the FrameDiff identity/selection color and separated motion/path semantics into
  violet and cyan.
- Renamed the right-hand `PROPS` tab to `INSPECT` so the UI and its content use one concept.
- Rebuilt the motion-path section around two clear intents:
  **Curve between keys** and **Draw movement**.
- Added a visual path explainer that labels solid stops and hollow curve handles in plain language.
- Collapsed numeric anchors and Bézier handles under **Precise path points** by default.
- Added canvas context hints for selection and path editing.
- Added a strong canvas recording mode with crosshair cursor, border state, status HUD, live sample
  count, completion guidance, and Escape cancellation.
- Reworded the no-clip state when motion lanes are driving the scene.
- Added short, state-reinforcing transitions and a complete `prefers-reduced-motion` fallback.

## Recommended next sequence

### Next: simplify the shell without removing capability

1. Add desktop **Focus** controls for the composition rail, Inspector, and timeline, persisting the
   user's layout per project.
2. Collapse Services, Cache, reload, and secondary render choices into one project menu while keeping
   Undo, Redo, diagnostics, and the primary render action visible.
3. Add a compact command/shortcut palette. It should search compositions and actions without creating
   a second navigation model.
4. Turn Inspector sections into remembered accordions with a small “edited/current/error” status in
   each header.

### Then: make browsing and timing more visual

1. Add a list/grid toggle with composition thumbnails, kind filters, folders/tags, recent items, and
   favorites. Keep the nested graph as the default for structural work.
2. Add timeline track visibility/lock/mute/solo, then waveforms and useful clip thumbnails.
3. Introduce explicit selection, razor, keyframe, and record tools only as their full behaviors exist;
   avoid a decorative NLE toolbar.
4. Add multi-select, alignment/distribution, safe-area overlays, and grouped source transactions.

### Finally: make source trust visible

1. Surface a small persistent preflight badge for diagnostics, missing media, stale bakes, and source
   conflicts.
2. Add a source transaction history with affected files and before/after diff.
3. Link every Inspector edit to its exact Code span and let users preview complex rewrites before
   committing them.

## Product principle

FrameDiff does not need fewer capabilities. It needs fewer capabilities demanding attention at the
same time.

The editor should always make three things obvious: **what is selected, what the next drag/click will
do, and which source authority will change**. Everything else can remain one deliberate step away.
