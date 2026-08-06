# HTML composition contract

> This is the implemented authoring ABI. Start with the canonical
> [architecture overview](./ARCHITECTURE.md) for package ownership, effects versus compositions,
> frame versus bake work, and project layout.

FrameDiff compositions are ordinary HTML documents. CSS defines layout, inline JavaScript or an
optional module defines behavior, and `data-fd-*` attributes expose timeline and property semantics
to preview, Studio, nesting, and export. There is no component-framework runtime in a composition.

## Minimal document

```html
<!doctype html>
<html>
<head><style>
  [data-fd-composition] { position: relative; overflow: hidden; background: black; }
  [data-fd-clip] { position: absolute; inset: 0; }
</style></head>
<body>
  <main data-fd-composition data-fd-id="Main"
    data-fd-width="1920" data-fd-height="1080"
    data-fd-fps="30" data-fd-duration="300"
    data-fd-kind="scene" data-fd-data-mode="source"
    data-fd-source="src/Main.html" data-fd-module="src/Main.ts" data-fd-export="mainComp">
    <section data-fd-clip data-fd-id="title" data-fd-name="Title"
      data-fd-from="0" data-fd-duration="90">
      <h1 data-fd-id="title-text" data-fd-text="Hello">Hello</h1>
    </section>
  </main>
</body>
</html>
```

`data-fd-id`, width, height, fps, and duration are required and must be positive. Root metadata can
also declare `data-fd-kind`, `data-fd-library`, `data-fd-alpha`, `data-fd-output`,
`data-fd-output-frame`, and an export window with `data-fd-render-from`/`data-fd-render-to`.
Authoring metadata includes `data-fd-data-mode="source"`, `data-fd-timeline="auto|always|hidden"`,
`data-fd-direct-manipulation`, `data-fd-document`, `data-fd-schema`, and
`data-fd-timeline-source`.

## Frame lifecycle

Trusted inline scripts receive `root`, `composition`, `document`, `onFrame`, `onDocument`,
`onCleanup`, `query`, `queryAll`, `resolveAsset`, and `interpolate`:

```html
<script>
  const title = query(".title");
  onFrame(({ frame, time, playing, gradeBypass }) => {
    title.style.opacity = interpolate(frame, [0, 12], [0, 1]);
    title.style.transform = `translateY(${Math.sin(time * 4) * 8}px)`;
  });
</script>
```

Inline scripts are project code, not sandboxed content. Use an imported setup module when code needs
imports, reusable application logic, TypeScript, a third-party library, WebGPU, or WebGL:

```ts
import { defineComposition, registerCanvasCapture } from "framediff";
import source from "./Scene.html?raw";

export const sceneComp = defineComposition(source, {
  setup({ query, onFrame, onCleanup }) {
    const canvas = query<HTMLCanvasElement>("canvas")!;
    const renderer = createRenderer(canvas);
    const stop = onFrame(({ frame, time }) => renderer.draw(frame, time));
    const stopCapture = registerCanvasCapture(canvas, (time) => renderer.capture(time));
    onCleanup(() => { stop(); stopCapture(); renderer.destroy(); });
  },
});
```

Preview and export mount the same document and call the same frame listeners. The runtime also sets
`--fd-frame`, `--fd-time`, `data-fd-frame`, and `data-fd-time` on the root. Every timed element gets
`--fd-local-frame`, `--fd-local-time`, and `data-fd-local-frame`.

### Source-owned code scenes

Use `data-fd-kind="scene"` with `data-fd-data-mode="source"` and
`data-fd-timeline="hidden"` for a source-owned
HTML/CSS/JavaScript render surface that should not have a timeline of its own. Code scenes keep
preview transport, receive the full `onFrame` state, and may reference any registered composition
with `data-fd-type="nested"` plus `data-fd-comp`. When an edit places a code scene on its timeline,
the callback receives the placement-local render
frame after edit start, trim, playback-rate, and fps mapping. Preview and export use that same
mapping.

The Studio's add-composition sheet offers this as the **Code scene** starter for the **Scene** kind.
It scaffolds an `.html` document and a tiny `.ts` registration module without creating `.comp.json`,
schema, or timeline files. The containing edit owns timing, rectangle, fit, radius, opacity, and
layer order in its timeline JSON; the code scene source
owns everything inside that rectangle.

Register every source-owned project scene with `defineCodeScene()`, never `defineComposition()`:

```ts
import { defineCodeScene } from "framediff";
import source from "./ProceduralMap.html?raw";

export const proceduralMapComp = defineCodeScene(source, {
  capabilities: ["dom", "nested-compositions"],
  dependencies: {
    assets: ["paper-texture"],
    compositions: ["HarborPreviz"],
    files: ["src/shaders/mapNoise.ts"],
  },
});
```

Empty dependency groups may be omitted; FrameDiff normalizes them to explicit arrays in
`meta.sourceContract`. Declared files feed render fingerprints, declared compositions feed the render
graph, and declared assets feed content hashes. Inline code must use `onFrame()` rather than wall-clock
scheduling and must resolve declared project inputs rather than fetching network state directly.

Timeline nodes remain mounted while inactive so setup state survives scrubbing. Built-in media,
grade, video-plane, and three.js adapters skip hidden branches automatically. An expensive code-scene
effect can do the same with `isVisualElementActive(canvas, root)`; capture and export also exclude
inactive visual and audio branches.

When `defineComposition()` receives a JSON `document`, setup code receives its initial value and can
register `onDocument(next => …)` for data-only Studio edits and HMR. This updates code-driven shaders,
simulations, or spatial tools without remounting the composition. JSON Schema and object-to-pointer
bindings are described in [COMPOSITION-AUTHORING.md](./COMPOSITION-AUTHORING.md).

The callback registered with `registerCanvasCapture` receives that canvas's clip-local time in
seconds. It must reproduce the same GPU state as preview at that time and return a readable canvas.

## Timeline and nesting

| Attribute | Meaning | Studio editable |
| --- | --- | --- |
| `data-fd-clip` | Make an element a timeline placement. | — |
| `data-fd-id` | Stable source identity. Required for source rewriting. | — |
| `data-fd-name` | Human-readable clip/timeline label. | — |
| `data-fd-from` | Placement start in owning-composition frames. | Yes |
| `data-fd-duration` | Placement length in owning-composition frames. | Yes |
| `data-fd-type="nested"` | Mark nested-composition content. | — |
| `data-fd-comp="Other"` | Registry key or composition id. | Yes |
| `data-fd-trim-start` | Media/nested source offset in seconds. | Yes |
| `data-fd-playback-rate` | Source time multiplier. | Yes |
| `data-fd-nested-scale` | Explicit nested canvas scale. Defaults to parent/child dimensions. | Yes |

Nested playback converts the parent-local frame through parent fps, trim, playback rate, and child
fps. Nested compositions share the same asset resolver and registry and can themselves contain
media, nested comps, DOM animation, WebGPU, or three.js.

## Media

Use ordinary `<video>`, `<audio>`, and `<img>` elements. `src` works for direct URLs;
`data-fd-src` additionally supports the FrameDiff resolver and `asset://` references.

| Attribute | Applies to | Meaning |
| --- | --- | --- |
| `data-fd-src` | video/audio/effect canvas | Authored source reference. |
| `data-fd-trim-start` | video/audio | Source offset in seconds. |
| `data-fd-playback-rate` | video/audio | Source rate. |
| `data-fd-volume` | audio | Gain clamped to 0–1. |
| `data-fd-muted` | video | Boolean mute. |
| `data-fd-fit` | video/visual element | CSS `object-fit`. |

When a media node sits inside a clip, an Inspector edit writes the media control to the selected clip.
The runtime deliberately treats that clip value as an override of the child node's authored default.
This makes the visual edit visible as a small, stable source diff.

## Editable visual properties

Properties are opt-in: put an attribute in source to expose it. The runtime maps the following
attributes to CSS or content and the Studio renders number, text, or boolean controls:

- Transform/layout: `data-fd-x`, `data-fd-y`, `data-fd-scale`, `data-fd-rotation`,
  `data-fd-width`, `data-fd-height`, `data-fd-opacity`, `data-fd-z-index`,
  `data-fd-border-radius`.
- Typography/content: `data-fd-text`, `data-fd-color`, `data-fd-background`,
  `data-fd-font-size`, `data-fd-line-height`, `data-fd-letter-spacing`.
- Renderer resolution: `data-fd-render-width`, `data-fd-render-height`.
- Custom controls: any `data-fd-prop-<name>`, optionally accompanied by
  `data-fd-prop-<name>-label` and `data-fd-prop-<name>-type="number|text|boolean"`.

Give editable descendant nodes their own `data-fd-id`. The Inspector can then show and rewrite, for
example, a heading's `data-fd-text` without moving the containing clip or replacing its children.
Custom properties are application data: a setup module reads them and decides what they control.

## Grade and GPU effects

`createGradeVideoSetup()` binds every `canvas[data-fd-grade-video]` to the existing WebGPU grade
renderer. `createVideoPlane3DSetup()` binds `canvas[data-fd-video-plane-3d]` to the 3D video-plane
renderer. Both support exact export capture and inherit media/effect controls from the closest clip.

Exposed grade attributes are:

- `data-fd-grade-exposure`, `contrast`, `saturation`, `temperature`, `tint`, `highlights`,
  `shadows`, `vignette`, `bloom`, and `bloom-threshold`;
- `data-fd-lut`, `data-fd-lut-name`, and `data-fd-lut-intensity`.

Use `data-fd-grade-layer` for a floating DOM grade over content below it. Use
`data-fd-prop-max-blur` on a 3D video plane to expose depth-of-field blur. Camera endpoints or full
keyframe tracks are passed to `createVideoPlane3DSetup`; `ease`, `linear`, and overshoot-safe
`monotone` interpolation remain available.

When a 3D plane is a self-contained shot with its own source/camera clock, use
`defineVideoPlane3DComposition()` instead of repeating generated HTML and renderer wiring. Fitted
normalized camera progress can be expanded with `cameraKeyframesFromProgress()`.

For three.js, author `canvas[data-fd-three]`, bind it with `createThreeSceneSetup()` from
`framediff/three`, and declare camera cuts as timed elements carrying `data-fd-camera="name"`.
`defineThreeSceneComposition()` provides that canvas/camera-cut composition boundary directly.

Project look and DOM-motion modules should configure packaged behavior rather than reimplement it:
`createNamedVideoLookSetup()`, `gradeDataAttributes()`, `createClipMotionSetup()`,
`createWipeRevealSetup()`, `createCharacterRiseSetup()`, and `createAudioFadeOutSetup()` cover the
common deterministic mechanisms. The project supplies look maps, motion rows, timing, and art
direction. See the [architecture promotion rule](./ARCHITECTURE.md#the-example-to-package-promotion-rule).

### DOM cloth

`createClothSetup()` turns an authored DOM element into a deterministic, textured cloth surface.
The source stays in the document for ordinary HTML/CSS editing and is made transparent by the
effect; the rendered cloth lands in `canvas[data-fd-cloth]` and participates in the same exact
GPU capture path as the other effects.

```html
<section id="cloth-card" class="card">
  <h1>FrameDiff</h1>
  <p>Ordinary live HTML, rendered as fabric.</p>
</section>
<canvas data-fd-cloth data-fd-cloth-source="#cloth-card"></canvas>
```

```ts
import { createClothSetup, defineComposition } from "framediff";

export const clothComp = defineComposition(source, {
  setup: createClothSetup({
    textureRefresh: "frame",
    simulation: {
      width: 3.2,
      height: 1.8,
      segmentsX: 32,
      segmentsY: 18,
      pins: "top",
      wind: (time) => [0.3 * Math.sin(time), 0, 0.8 + 0.2 * Math.sin(time * 1.7)],
      impulses: [
        { frame: 24, uv: [0.52, 0.42], force: [0, 0, 5], radius: 0.14 },
      ],
    },
  }),
});
```

`textureRefresh` is `"frame"` by default for animated HTML. Use `"mutation"` for mostly static
content edited in the Studio, or `"once"` for a fixed texture. Cloth physics uses fixed substeps,
seeded initialization and checkpointed absolute-frame seeking, so backward scrubbing and export
replay the same state. Canvas attributes can override the common physical controls:
`data-fd-cloth-width`, `height`, `segments-x`, `segments-y`, `mass`, `gravity`, `damping`,
`stiffness`, `bend-stiffness`, `substeps`, `iterations`, `roughness`, and `metalness`.

## Planning compositions

Pre-production documents are ordinary compositions with `data-fd-kind="plan"`: scripts,
rundowns, and shot lists whose timed rows are `data-fd-clip` elements. Because rows are
clips, a plan scrubs like a timeline and sits in the same composition graph as everything
else. `data-fd-kind="script"` additionally opens the Studio's full-height script sheet:
duration is the timing input, starts are derived contiguously, and each edit is one
reversible source transaction. Rows nest the comps they reference (`data-fd-type="nested"` + `data-fd-comp`
inside a row renders a live thumbnail of the scene, take, or library card that
realizes it, and the rail tree follows those references like any other nesting), and
lighter cross-links ride on `data-fd-prop-*` attributes (scene, cast, location, status
ids). Only reference direction distinguishes roles: masters nest plans' outputs,
plans nest previews of them, generative comps can take either as refs. The
new-composition sheet offers a plan scaffold.

The `framediff` planning module gives plans verbs:

- `parsePlanRows(source)` — read the timed rows and their `data-fd-prop-*` refs.
- `parseScriptSheet(source)` — read addressable script prose and source slots.
- `retimePlanRows`, `movePlanRow`, `insertPlanRow`, and `deletePlanRow` — mutate the
  row sequence while deriving contiguous starts, source-slot timing, and total duration.
- `setPlanRowSource(source, rowId, source)` — atomically switch a marked source slot
  between a nested comp and image/video/audio media without stale attributes.
- `generateEditSkeleton(planSource, options)` — derive a master edit with one nested
  placement per row (the animatic/recording-skeleton transform); timing is shared by
  construction. `defineEditSkeleton()` returns it as a ready composition.
- `planDrift(planSource, masterSource)` — planned vs actual per shared id (a master
  placement matches on `data-fd-prop-plan`, falling back to `data-fd-id`).
- `applyPlanActuals(planSource, masterSource)` — sync the master's timing back into the
  plan (capture-first workflows, where the recording owns the truth).
- `defineMoodboardComposition(data, options)` — the stock scratchpad surface: project
  data (JSON: items + camera) in, package-owned canvas UX out — pan, wheel zoom,
  minimap navigation, card drags, in-place text editing — persisted back to the data
  file via the dev filesystem. `data-fd-interactive` on a root hands the comp its own
  pointer events (the Studio overlay steps aside).
- `copyHtmlElementInto(fromSource, elementId, toSource)` — copy a card, cast entry, or
  row into another composition as source, ids re-uniqued against the destination.
- `swapNestedComp(source, clipId, compId, status?)` — progress a slot by rewriting its
  `data-fd-comp` (board → previz → final), optionally advancing
  `data-fd-prop-status` (see `PLANNING_STATUSES`).

A script-sheet row uses stable child ids and role markers:

```html
<section data-fd-clip data-fd-id="scene-approach"
  data-fd-from="0" data-fd-duration="90">
  <h3 data-fd-id="scene-approach-title" data-fd-script-field="title">Approach</h3>
  <p data-fd-id="scene-approach-narration" data-fd-script-field="narration">Any light will do.</p>
  <p data-fd-id="scene-approach-visual" data-fd-script-field="visual">Low over the swell.</p>
  <p data-fd-id="scene-approach-sfx" data-fd-script-field="sfx">Bell buoy</p>
  <div data-fd-clip data-fd-script-source data-fd-id="scene-approach-source"
    data-fd-type="nested" data-fd-comp="approachShot"></div>
</section>
```

An optional addressable element with `data-fd-script-field="summary"` supplies the
sheet header notes. The source slot stays the same element when its type changes.

Each pre-production document is its own first-class kind — `moodboard`, `script`,
`locations`, `cast` (with `plan` as the generic fallback) — and
`kind="scene"`/`kind="board"` mark per-scene source comps and promoted scene
holds. Card-library kinds (moodboard/locations/cast) have no temporal axis, so the
Studio hides timeline chrome for them.

## Source editing rules

- Physical `.html` compositions support timeline and Inspector source rewriting.
- A source-edited element needs a unique `data-fd-id`.
- Rewrites preserve surrounding formatting and change or insert only the requested attribute.
- JavaScript-generated HTML declares `meta.sourceFormat: "generated"`; its placements are read-only.
  Generated comps can still expose code-backed object arrays and camera data through `editableData`.
- Composition setup modules and their declared dependencies participate in registry HMR and build
  fingerprints.
