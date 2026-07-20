# FrameDiff — node graph + timeline GUI, backed by code

> **Document role:** prospective explicit node/timeline IR design. FrameDiff currently keeps authored
> HTML/TypeScript as the source of truth and projects supported effects into Studio metadata; see the
> canonical [architecture overview](./ARCHITECTURE.md) and
> [editing contracts](./STUDIO-EDITING-CONTRACTS.md).

Single design spec · 2026-06-29 · builds on [COMPOSITION-GRAPH.md](./COMPOSITION-GRAPH.md)

---

## 1. The goal

A composition — and every effect inside it (color grade, vignette, the 3D plane, …) — should be
viewable and editable in **two interchangeable surfaces**:

- a **node graph** (Nuke/Fusion/TouchDesigner-style data flow), and/or
- a **timeline** (After Effects/NLE-style tracks, clips, keyframes),

with every node exposing **GUI-tweakable properties** (a `vignette` slider, a colour wheel, a camera
control) — while **code stays the source of truth**. Edit in code → the GUI reflects it. Tweak in the
GUI → the code updates. One project, never a divergent second copy.

Concretely we want to be able to:
1. tweak any effect's **parameters** in a GUI (vignette, exposure, …);
2. on the **timeline**, change **when a clip plays**, **which portion of a clip's source is used**, and
   **when/where an effect applies**;
3. apply effects to **a clip, a region of a clip, or the whole composition output** (an adjustment layer);
4. drive the **virtual 3D camera** (the plane-in-space shots) with artist-friendly, animatable controls,
   including **depth of field**.

---

## 2. The first cut (scope)

We do **not** need full node-graph authoring on day one. The first GUI exposes exactly these edits
**when the value has an editable source span**, and every write is a "rewrite a literal at a known source
location" codemod — the most robust round-trip there is. If a value is computed (`RAW.map(...)`,
derived totals, inline expressions) — or shared by several nodes, where one edit would change all of
them — the GUI never silently rewrites it: it is read-only until materialized, or edited through an
explicit "edit all / fork this one" choice (§9.1). No structural codegen, no graph mutation, no rewriting
of hand-authored logic.

| Edit | Surface | Writes back |
|---|---|---|
| **Parameter tweaking** — any node's params (the `vignette` slider, the camera `fov`) | Inspector | the param literal |
| **Clip placement** — when a clip plays in the comp | Timeline | `from` / `durationInFrames` |
| **Source trim** — which portion of a clip's source is used (slip in-point / trim out) | Timeline | `trimStart` (+ `durationInFrames` for trim-out) |
| **Effect window** — when an effect applies on a clip (or the whole comp) | Timeline | effect `from` / `durationInFrames` |

The model must also support one structural capability: an **effect can be attached at any level** — a
clip, a track, or the **composition output** (adjustment layer) — each optionally windowed. In the first
GUI, editing existing declared attachments is in scope; creating new attachments from scratch is
structural authoring and stays deferred.

**Deferred** (not the first cut): adding/wiring/deleting nodes in the GUI, building a comp from scratch
in the GUI, keyframe-curve authoring, editing arbitrary code. A node-graph view, if shown early, is
**read-only** (visualisation). Structure stays authored in code; the GUI tweaks values and timing inside it.

---

## 3. Why the last GUI failed, and the principle that replaces it

The previous app (removed in `9d47cf3`) bidirectionally synced **arbitrary TypeScript ⇄ a JSON model**.
That sync was the pain: round-tripping hand-written code through a data model is brittle, and the two
could silently disagree. The principle that shapes this design:

> **Separate _data_ from _logic_.** The GUI is authoritative only over structured **data** regions, which
> round-trip losslessly. **Logic** (custom components, `.map()`s, expressions) is respected but treated
> as opaque — the GUI never rewrites it.

The hero-reel is close to this (`GRADE`, the raw shot list, `CAPTIONS`, and `edl.ts` contain data
islands; computed `SHOTS`/running totals and the JSX/`.map()` around them are logic). We lean into that
split instead of fighting it.

Two abstractions make the whole thing fall out cleanly:

- **An effect is one node** — one media input, one media output, an optional time window — **attachable to
  any media output**: a clip, a track, or the composition root. "Grade the whole comp" is not a special
  feature; it's the same `colorGrade` node sitting between the final composite and the output.
- **Time is a property of nodes, not a separate structure.** So the node graph and the timeline are two
  *projections of one DAG*, not two models.

---

## 4. The model — one serializable IR

Today there are *two* graphs: an explicit **bake-phase** DAG (`PlanNode` in `graph/planner.ts`, for
assets/precomps/3D/generators) and an *implicit* **frame-phase** tree (whatever the React composition
renders). This makes the frame phase a **first-class serializable IR** shaped like the bake graph, so
they connect into one DAG.

```ts
// The whole editable document. Serializable, canonicalJSON-able, fingerprintable.
interface SceneDoc {
  version: 1;
  id: string;
  format: { width: number; height: number; fps: number; durationInFrames: number };
  nodes: Record<NodeId, SceneNode>;
  root: NodeId;                 // the node whose output is the final frame
  view?: { nodePositions: Record<NodeId, { x: number; y: number }> }; // node-canvas layout only
}

interface SceneNode {
  id: NodeId;
  type: string;                 // registered node-type key: "video" | "colorGrade" | "plane3d" | "composite" | "text" | "precompRef" | …
  inputs: Record<PortName, NodeRef>;       // typed input ports → upstream node + output port
  params: Record<ParamName, ParamBinding>; // constant or animated (§6)
  placement?: TemporalPlacement;           // present iff the node appears on the timeline; comp-frame units unless noted
  source?: NodeSourceRef;                   // where the node/authoring construct came from
  fieldSources?: Record<FieldPath, SourceRef>; // per-value provenance for write-back (§9)
}

type NodeRef = { node: NodeId; output: PortName };
type FieldPath = string; // e.g. "placement.from", "placement.trimStart", "params.grade.vignette"
type SourceRange = { start: number; end: number }; // byte offsets or TS AST positions, chosen by the codemod layer
type NodeSourceRef = { file: string; loc: SourceRange; opaque?: boolean };
type SourceRef = { file: string; loc: SourceRange; writable: boolean; reason?: string };
interface TemporalPlacement {
  track: number;
  from: number;                 // comp frames
  durationInFrames: number;     // comp frames
  trimStart?: number;           // source seconds, matching today's <Video trimStart>
}
```

This deliberately mirrors `PlanNode` (`{ id, kind, params, inputs }`), so a `precompRef`/`render3d` node
is the seam where the **frame-phase DAG plugs into the existing bake-phase DAG** — the "3D → video-to-
video → composite" flow COMPOSITION-GRAPH.md §5 already envisions.

**Signals (typed ports).** Every output has a signal type so the node editor can validate wiring:
`video` (RGBA frame), `audio`, `mask`/`alpha`, `scalar`, `vec2`/`vec3`, `transform`, `scene3d`, `lut`.

**Attach points & source range.** A clip's `placement.trimStart` is its **source in-point** in seconds;
the used source range is `[trimStart, trimStart + durationInFrames/fps]`, so timeline in/out handles
edit `trimStart` (slip) and `durationInFrames` (trim). Clip effect windows are local to the clip;
track/output effect windows are in composition time. Because an effect is just an effect node, the
*same* `colorGrade` can sit on a clip, on a track, or between the composite and `root` (an adjustment
layer over the whole comp).

**Audio.** Audio is the `audio` signal: an audio clip is a **temporal source node** (today's `<Audio>`)
carrying `volume` (and `fadeIn`/`fadeOut`) params; an **audio-mix** composite sums the active clips into
the output alongside video. On the timeline audio clips get their own lanes, `volume` animating as a
keyframe lane (fades); the renderer is the existing exporter audio pass (`data-framediff-audio`
reconstruction), unchanged. A video track and an audio bed are the *same kind* of temporal node — only
the signal type differs — so the timeline and the model treat them uniformly.

---

## 5. Two views, one DAG: node graph ⇄ timeline

Each node has a **facet** that decides where it shows up. Both views edit the *same* nodes.

| Facet | Meaning | Node view | Timeline view |
|---|---|---|---|
| **source** | generates a signal (`video`, `text`, `solid`, `render3d`) | a box | the body of a clip |
| **temporal** | has `placement` → active over `[from, from+durationInFrames)`, shifts child time (today's `<Sequence>`) | a box | a **clip** on lane `track`, with **in/out handles** |
| **effect** | 1 media in → 1 media out (`colorGrade`, `plane3d`, `blur`); optional time-window | a box in a chain | a **movable/trimmable bar** in the clip's effect stack |
| **composite** | N media in → 1 out, ordered | a fan-in box | the **track stack** (input order = z-order) |
| **output/adjustment** | an effect on a track or `root` | a box before `root` | a **full-width effect lane** above the clips it covers |

- **Node view** renders the DAG verbatim — chains, branches, a precomp feeding two places, bake nodes
  upstream. Free-form (Nuke-style).
- **Timeline view** is a *projection*: every `temporal` node is a clip at its `placement`; its effect
  chain is the clip's effect stack; the root composite's ordered inputs map to track z-order; track/output
  effects are adjustment lanes. Dragging a clip edits `placement.from/durationInFrames`; dragging
  in/out handles edits `trimStart`/`durationInFrames`; dragging an effect bar edits its window. **Same
  nodes, same edits.** Audio clips appear as their own lanes (drag/trim like video clips; `volume` is a
  keyframe lane for fades).

"and/or" falls out: a Nuke-style comp may have no temporal nodes (empty timeline); an AE-style comp is
tracks-of-clips-with-effect-stacks — both are the same `SceneDoc`, openable in either surface.

---

## 6. Parameters & animation — one binding behind every control

A parameter value is a **binding** evaluated at `frame`. A GUI slider and a timeline keyframe edit the
*same* object, so the two surfaces never disagree.

```ts
type ParamBinding =
  | { kind: "const"; value: Json }
  | { kind: "keyframes"; keys: { frame: number; value: Json; easing?: EasingName }[] }
  | { kind: "spring";   from: number; to: number; config?: SpringConfig; delay?: number }
  | { kind: "expr";     code: string }                 // sandboxed fn of (frame, fps, inputs) — power users
  | { kind: "link";     ref: NodeRef };                // drive from another node's scalar output

function evalParam(b: ParamBinding, frame: number, fps: number): Json; // uses interpolate()/spring()
```

`keyframes`/`spring` reuse the already-deterministic `interpolate.ts` and `spring.ts`. A `number` param
with a range renders as a slider when `const`, and grows a keyframe lane on the timeline when animated —
toggled by a stopwatch, AE-style. `expr` is the escape hatch (opaque to the GUI, still serialized).

---

## 7. The registry — typed node-types make the GUI generate itself

Every effect/source/composite is registered once with a **parameter schema** and view facets. The
inspector is *generated* from the schema, so adding an effect in code automatically makes it tweakable —
no per-effect GUI code. This is the missing layer today (effects are bare `GradeParams`-style prop bags
with no ranges/defaults/UI hints).

```ts
type NodeFacet = "source" | "temporal" | "effect" | "composite" | "output";

interface NodeTypeDef {
  type: string;                          // "colorGrade"
  facets: NodeFacet[];                   // e.g. ["source", "temporal"] for video; ["effect"] for colorGrade
  inputs: PortSpec[];                    // [{ name: "in", signal: "video" }, { name: "lut", signal: "lut", optional: true }]
  outputs: PortSpec[];                   // [{ name: "out", signal: "video" }]
  params: Record<string, ParamFieldSchema>;
  component: ComponentType<any>;         // how it renders in the frame phase (reuses today's components)
  fingerprintRecipeVersion?: string;     // folds into the cache key (graph/fingerprint.ts)
}

interface ParamFieldSchema {
  type: "number" | "bool" | "color" | "vec2" | "vec3" | "angle" | "enum" | "select" | "curve" | "asset" | "lut";
  default: Json;
  min?: number; max?: number; step?: number;     // number/angle → slider
  unit?: "deg" | "px" | "x" | "f-stop";          // display + (e.g. deg↔rad) conversion
  options?: string[];                            // enum → dropdown
  ui?: { control?: "slider" | "knob" | "colorwheel" | "xy"; group?: string; label?: string; advanced?: boolean };
}

// authored next to the existing GradedVideo, wrapping today's GradeParams 1:1:
defineNodeType({
  type: "colorGrade",
  facets: ["effect"],
  inputs: [{ name: "in", signal: "video" }, { name: "lut", signal: "lut", optional: true }],
  outputs: [{ name: "out", signal: "video" }],
  params: {
    temperature: { type: "number", min: -1, max: 1, step: 0.01, default: 0, ui: { group: "White balance" } },
    tint:        { type: "number", min: -1, max: 1, step: 0.01, default: 0, ui: { group: "White balance" } },
    exposure:    { type: "number", min: -2, max: 2, step: 0.01, default: 0, ui: { group: "Tone" } },
    contrast:    { type: "number", min: -1, max: 1, step: 0.01, default: 0, ui: { group: "Tone" } },
    vignette:    { type: "number", min:  0, max: 1, step: 0.01, default: 0, ui: { group: "Effects" } },
    bloom:       { type: "number", min:  0, max: 2, step: 0.01, default: 0, ui: { group: "Effects" } },
    // …highlights, shadows, saturation, lutIntensity, bloomThreshold
  },
  component: GradedVideo,
});
```

The registry is also what makes a node **fingerprintable** (`graph/fingerprint.ts`) → optional per-node
frame cache (§10).

---

## 8. The virtual 3D camera node (`plane3d`)

The `plane3d` node textures a clip onto a flat quad and renders it through a **virtual perspective
camera** with **depth of field** (today's `scene3d`/`VideoPlane3D`). It's how a flat app-UI screenshot
becomes a dramatic plane-in-space shot. The raw renderer consumes `eye`, `target`, `fov`, plane
`position`/`rotation`, and `dof {focus, aperture, maxBlur}` — but **raw camera vectors are not
artist-friendly** (six unlabelled numbers for `eye`/`target`). So the node exposes **derived,
animatable controls** and maps them to the renderer internally.

### Parameter groups

**Camera (framing)** — `cameraMode` picks one source of truth so the camera is never double-driven:
| Param | Type / range | Default | Meaning |
|---|---|---|---|
| `cameraMode` | enum `orbit` \| `manual` | `orbit` | `orbit` uses the controls below; `manual` exposes raw `eye`/`target` and ignores the orbit controls |
| `fov` | angle, 10–120° | 45 | field of view — low = telephoto/flat, high = wide/dramatic perspective |
| `dolly` | number, 0.4–6 | 1.1 | camera distance from the plane (push in / pull back) |
| `orbitYaw` | angle, −90…90° | 0 | horizontal orbit around the plane → the left/right keystone/tilt |
| `orbitPitch` | angle, **−89…89°** | 0 | vertical orbit → tilt up/down (clamped shy of ±90° to avoid the look-at gimbal) |
| `panX`, `panY` | number, −1…1 | 0 | where the camera looks (target offset, plane units) |
| `eye`, `target` | vec3 (`manual` mode only) | — | raw camera vectors; the orbit controls are hidden in this mode |

**Plane (the surface)**
| Param | Type / range | Default | Meaning |
|---|---|---|---|
| `posX/Y/Z` | number | 0 | plane position in the scene |
| `rotX/Y/Z` | angle (°) | 0 | plane rotation — declared in **degrees**, converted to the renderer's radians. Tilting the plane is an alternative to orbiting the camera |

**Depth of field** (the explicit ask — "adjust the depth of field on the virtual camera")
| Param | Type / range | Default | Meaning |
|---|---|---|---|
| `dofEnabled` | bool | false | turn DoF on/off |
| `aperture` | number, 0–1 (or f-stop) | 0 | blur strength / bokeh amount — **the depth-of-field control** |
| `focusDistance` | number | = `dolly` | distance from the camera that stays sharp |
| `autoFocus` | bool | true | lock `focusDistance` to the plane centre so it stays sharp as the camera moves |
| `maxBlur` | number (advanced) | 0.03 | clamp on blur radius (quality/perf cap) |

### Animation

**Every one of these is a `ParamBinding`**, so the camera move is just **keyframes** — e.g.
`orbitYaw` 0°→−28°, `orbitPitch` 0°→18°, `dolly` 1.09→1.66, `aperture` 0→0.4, all eased.
`VideoPlane3D` exposes this as `cameraFrom` / `cameraTo` endpoints plus static plane transform props.

**v1 vs later.** Full keyframe-curve authoring is deferred (N7+). In the first cut you edit the move's
**two endpoints** — the `cameraFrom` / `cameraTo` objects (literal islands) — plus constant plane
params: "make the move steeper" = move the end camera position/target in the island (not add a
keyframe); "pull the depth of field up over the shot" = raise the end `depthOfField`. The endpoints
still desugar to the start/end keyframes, so the rendered result is identical; arbitrary intermediate
keyframes wait for N7+.

### Friendly controls → renderer (orbit mapping)

The node computes the renderer's `eye`/`target`/`focus` from the artist params each frame; the renderer
(`scene3d`) is unchanged:

```
// orbit mode (manual mode skips this block and uses eye/target directly):
yaw, pitch    = orbitYaw, clamp(orbitPitch, -89°, +89°)   // clamp avoids the look-at gimbal at ±90°
target        = planeCentre + (panX, panY, 0)
dir           = ( cos(pitch)·sin(yaw),  sin(pitch),  cos(pitch)·cos(yaw) )
eye           = target + dolly · dir
focusDistance = autoFocus ? |eye − planeCentre| : focusDistance
// fov, plane pos/rot pass through (rot converted °→rad)
// dof = { focus: focusDistance, aperture: dofEnabled ? aperture : 0, maxBlur }
```

### Inspector & gizmo

v1 = **sliders + keyframes**, grouped Camera / Static plane / Depth of field. A draggable on-canvas camera
gizmo (orbit by dragging the preview, pull focus by scrubbing) is a natural later addition but not
required — the sliders + keyframes fully express the move. Plane transforms are constants on the
effect; only the virtual camera/lens fields animate over time.

---

## 9. Code as the source of truth — the round-trip

Three tiers, one compiler bridging model ⇄ source.

**Code → Model (always available).** *Run* the composition to recover the IR: bake nodes from
`plan(def)` (exists); frame-phase nodes from a **trace render** where FrameDiff's declarative components
(`Clip`, `Effect`, `Composite`, `GradedVideo`…) register their `SceneNode` + params into a model builder
as a side channel while still emitting the same DOM. Arbitrary JSX/components are opaque unless wrapped
in a declarative boundary; the trace records an opaque `custom` node for that boundary, and preview/export
continue through the `data-framediff-*` seam.

**Model → Code.** For the **v1 edits (all literals)** this is a targeted **AST codemod**: each editable
field carries `fieldSources[path] = { file, loc, writable: true }`; a slider drag or timeline drag
rewrites *only* that literal (`vignette: 0.34`, `from={10}`, `trimStart={5.47}`), preserving formatting
and surrounding logic. If a value has no source span, or the span points at a derived expression rather
than a literal/object field, it is read-only in v1. GUI-*authored* structure (deferred) would instead
serialize to a canonical `*.scene.ts` printed deterministically with stable node IDs.

**Reconciliation (the detail that bit v1).** During a GUI session the **in-memory model is the runtime
authority**; source writes are a debounced *serialization*. External code edits arrive via Vite HMR →
re-trace → new model; we **suppress the echo** of our own writes by diffing (re-traced ≡ current ⇒
ignore) and guard in-flight edits with a dirty flag. One authority at a time, idempotent re-trace — no
tug-of-war.

```
   ┌── GUI edit ──► mutate model ──► (instant) re-render preview
   │                      │
   │                      └─ debounce ─► AST patch the literal ─► file
   │                                                               │
   └──────────────── re-trace ◄── HMR ◄── (also external edits) ───┘
                     (idempotent; echo-suppressed)
```

### 9.1 Write-back scope — what's editable, and the shared-value rule

A field is **writable in v1** only when its value resolves, by static analysis, to a **single literal**
the codemod can rewrite. The three cases:

- **Editable** — an inline literal prop (`from={10}`, `trimStart={5.47}`), or a param field whose value
  is a literal, *including one reached through an identifier that points at a single-use const* (resolve
  `params={GRADE}` → the `vignette:` literal inside `GRADE`).
- **Read-only (shown, never silently rewritten)** — a **computed** value (`{...GRADE, ...override}`,
  `RAW.map(...)`, a running-total `from`) or a value with no literal span. The inspector shows it with a
  **"materialize to edit"** action that first hoists it into an explicit island (inline the spread, or
  expand the EDL into explicit placements), *then* allows edits.
- **Shared** — when one literal backs **N nodes** (e.g. `GRADE` is used by every shot), the inspector
  labels it *"shared by N"*; an edit asks **edit-all** (rewrite the shared const → changes every user) or
  **fork** (clone the const / add a per-node override island, then edit that). Never an ambiguous silent
  global change.

So write-back needs **symbol resolution** layered on the runtime trace (follow the JSX prop to its
declaration), not just the trace itself. And note the *current* hero-reel grade is mostly shared/computed
(`GRADE` + the `{...GRADE, ...override}` spread), so N5 either edits the look **globally** or triggers a
materialize/fork — expected and surfaced, not a surprise.

---

## 10. Rendering & caching — reuse the proven path

The IR does **not** replace the renderer; it *compiles to* the existing React tree. Each `SceneNode`
maps to its registered `component`; the tree mounts under today's `FrameProvider`/`Player`/`exportVideo`
with the **`data-framediff-video` / `data-framediff-webgpu` / `__framediffCapture` seam intact**. Preview and
the deterministic encode are unchanged — a model in front, not a new pipeline.

Caching extends naturally: each frame-phase node gets a fingerprint (§7); expensive nodes (3D,
generators) are already content-addressed bake nodes (P3). Optional **per-node frame memoisation** keyed
by `(fingerprint, frame)` gives Nuke-style scrubbing; preview can render at proxy resolution and only the
affected subgraph.

---

## 11. The authoring layer — `<Scene>` / `<Clip>` / `<Effect>` / `<Output>`

The one prerequisite the scope needs: a declarative layer that **separates a clip's source from its
effects**, so effects are individually time-scopable and attachable to a clip / track / output. This is
what the trace reads and the codemods edit; it replaces fused components like `<GradedVideo>` for
GUI-edited comps (raw React still works as opaque nodes). Use a new root name such as `<Scene>` here;
today's exported `<Comp>` already means "consume a baked precomp media bundle."

```tsx
<Scene>
  <Track>                                              {/* z-order: later tracks composite on top */}
    <Clip src="/clips/s04a.mp4" from={145} durationInFrames={84} trimStart={5.47}>
      <Effect type="colorGrade" params={GRADE} />
      <Effect type="vignette" from={10} durationInFrames={30} params={V} />
    </Clip>
    <Clip src="/clips/s05.mp4" from={295} durationInFrames={50}>
      <Effect type="plane3d" params={{ poseFrom: FLAT, poseTo: TILT, dofEnabled: true }} />
    </Clip>
  </Track>

  <Track>                                              {/* overlay track, composites on top */}
    <Clip kind="text" from={70} durationInFrames={80} params={{ text: "…" }} />
  </Track>

  <Sound src="/music.m4a" volume={0.55} />             {/* an audio lane */}

  <Output>
    <Effect type="colorGrade" params={LOOK} />         {/* adjustment over the whole comp */}
  </Output>
</Scene>
```

`<Track>` maps to `placement.track` and its order is z-order (later = on top); a flat list of `<Clip>`s
with no `<Track>` is a single implicit track. `<Sound>` is an audio temporal node; `<Output>` holds
comp-level adjustment effects. `from` / `durationInFrames` / `trimStart` / `params` are plain literals —
timeline drags and inspector sliders land as targeted edits to them. Where positions are *computed* —
e.g. hero-reel's back-to-back EDL with a running `from` — clip placement is display-only in v1 until the
island is materialized into explicit placements (§9.1); automatically editing a `durationInFrames` that
feeds a running total would silently move downstream clips, so the codemod must not.

---

## 12. Phased plan (hero-reel keeps rendering throughout)

| Phase | Build | Exit criteria |
|---|---|---|
| **N0** | `defineNodeType` + param **schemas** for existing effects (colorGrade, **plane3d/camera**, lut, cornerPin, video, text, composite, sequence). Purely additive. | Every shipped effect has a schema; a dev `<Inspector>` renders controls for a hand-built node. |
| **N1** | `SceneDoc` IR + an **interpreter** that compiles it to the React tree (reusing components). | Hand-written `SceneDoc` renders **and exports byte-identically** to the JSX version (golden-frame test). |
| **N2** | The `<Scene>` / `<Clip>` / `<Effect>` / `<Output>` authoring layer (§11): source/effect separation, time-scopable effects, clip/track/output attach. Port one hero-reel shot. | A clip with a whole-clip grade + a windowed vignette + a comp-level output grade renders identically. |
| **N3** | **Trace** (Code→Model) for the declarative components; emit `SceneDoc` with source spans and read-only markers. | The ported hero-reel shot round-trips JSX → IR → pixels identically. |
| **N4** | **Read-only timeline + inspector** over the `SceneDoc` (node-graph view optional, read-only); playhead synced to preview. | Open hero-reel: see clips, source ranges, per-clip effect windows, and display-only param/camera controls. |
| **N5** | **Param write-back** via AST codemod, starting with the `GRADE` island (incl. the `plane3d` camera params). | Drag `vignette` or camera `fov` → source + preview update; deterministic; clean diff. |
| **N6** | **Timeline write-back** — move/trim clips, slip/trim a clip's source range (`trimStart`), and move/trim effect windows (incl. comp-level adjustment effects). | Drag an effect bar or a clip in/out handle on a literal-backed item → the literal updates; preview follows. |
| **N7+** | _(deferred — not the first cut)_ structural editing (add/wire/delete nodes, GUI-authored comps), keyframe-curve authoring, camera gizmo, undo/redo, per-node frame cache, presets. | Build a comp from scratch in the GUI; node edits write clean `.tsx`. |

**Thin vertical slice** to prove the thesis end-to-end: N0 + a hand-built `SceneNode` with
`fieldSources` + the smallest N5 codemod that patches the `GRADE` island — "GUI-tweakable vignette,
backed by code." Since `GRADE` is shared by every shot, this first slice edits the look **globally** (the
shared-const path of §9.1); the per-clip fork/materialize action lands with N5 proper. The timeline half
is then one N6 drag on a literal-backed effect window. Neither needs the node canvas or any structural
editing.

---

## 13. Risks & tradeoffs (honest)

1. **Arbitrary or computed/shared code is opaque** — you can't GUI-edit a hand-written `.map()` or a
   custom component's internals, and a value backed by a shared/computed expression is read-only until
   materialized or forked (§9.1). Deliberate; mitigated by an expressive declarative layer, hoisting data
   into editable consts, and the explicit edit-all/fork affordance.
2. **Generated/patched code must stay clean & stable** — deterministic printing, pinned node IDs,
   island-only touches — or it fights the author and git. Real investment in the printer/codemod.
3. **Trace faithfulness** — imperatively-animated props (`opacity: spring(...)` inline) can render, but
   they are opaque/read-only unless hoisted into a `ParamBinding`; only declarative animation
   (`keyframes`, `spring`, `poseFrom`/`poseTo`) is GUI-editable.
4. **Two authorities during a session** — model (runtime) vs source (rest). The echo-suppression +
   dirty-flag + idempotent re-trace policy (§9) is what prevents the flicker/clobber that sank v1.
5. **3D camera intuition** — raw `eye`/`target` are unusable in a GUI; the orbit/dolly/pan + DoF
   abstraction (§8) is what makes the virtual camera tweakable. Keep the raw vectors as an advanced
   escape hatch only.
6. **Live re-eval cost** — slider drags re-render at full res. Mitigate with per-node frame cache,
   affected-subgraph-only rendering, and proxy-resolution preview.

---

## 14. How this answers the asks

- **node and/or timeline** → one DAG IR; node view = the DAG, timeline = its temporal projection; both
  edit the same nodes.
- **GUI-tweakable properties (vignette, camera, …)** → a registry of typed param schemas generates the
  inspector; every binding is animatable via the same keyframe/spring model the timeline shows.
- **timeline editing — clip timing, used source range, where an effect applies** → all are `placement` /
  `trimStart` / effect-window literals with source spans, dragged on the timeline.
- **effects on a clip, a region, or the whole output** → an effect is one node attachable to any output
  (clip / track / `root`), optionally windowed.
- **the 3D camera** → artist-friendly, animatable orbit/dolly/pan + **depth-of-field** params (§8) that
  map to the existing renderer.
- **backed by code** → code is the source of truth at rest; the declarative layer round-trips losslessly
  (codemod for the v1 literals); arbitrary code is respected as opaque. The GUI is a *projection of
  code*, never a fork of it.

---

## Addendum — 2026-07-02

The "two projections of one DAG" idea in this spec generalizes: **projections are pluggable and
user-space**. Workflow surfaces beyond node graph/timeline (storyboards, scripts, podcast rundowns,
transcripts) are **not** new node facets — they are *docs* (authoring data with stable block ids,
linked to nodes, and declarable as fingerprint inputs) rendered by *views* (`defineView`, built on
the same two write paths this spec defines: param bindings and span rewrites). The timeline itself
becomes the first built-in view. Full design: [WORKFLOWS-AS-VIEWS.md](WORKFLOWS-AS-VIEWS.md);
demo: [prototypes/three-workflows](../prototypes/three-workflows/).
