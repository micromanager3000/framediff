# FrameDiff vs. HyperFrames and the FrameDiff-native gap-closure plan

> Date: 2026-07-15
> FrameDiff snapshot: `929ffcf480ac52321f91ea39587b648594ef8736`
> HyperFrames snapshot: `35e623b4f3502a88945750955000f59526a62ed3`
> Status: M0–M9 implemented and release-audited

## Companion diagrams

- [Comparison map](./framediff-vs-hyperframes.html)
- [FrameDiff-native end-to-end implementation map](./framediff-gap-closure-plan.html)
- [M0–M9 release audit](./GAP-CLOSURE-M0-M9-AUDIT.md)

## Delivery update — M0 through M9 implemented

The comparison below remains an audit of the two `main` snapshots named above. The gap-closure program
has since been implemented on `codex/gap-closure-m0-m9` as one source-backed system:

| Milestones | Delivered evidence |
| --- | --- |
| M0–M1 | Stable project identity and authority contracts; atomic revision-checked source transactions; exact receipts; grouped edits; conflict-safe Undo/Redo. |
| M2–M4 | Preview hit-testing, scaled/rotated move and resize, direct text and rich typed visual controls, explicit/persistent lanes, stacking and playback-rate-aware real media front trim. |
| M5–M6 | Optional paused `framediff/gsap` adapter driven only by absolute composition frames; registered tween/key/ease projection and source editing; auto-key and canvas-to-key routing. |
| M7–M8 | Cubic/arc paths, anchor and tangent editing, one-sample-per-frame gesture fitting, and helper `unroll()` with AST call-site isolation plus normalized runtime pre/post proof. |
| M9 | `window.__framediffAgent` inspect/check/snapshot/execute API, complete source revision guards, asset/artifact status, file-level race diagnostics, shared history, exact PNG feedback and a visible Studio diagnostic panel. |

Showcase compositions are available at `direct-manipulation-lab`, `rich-properties-lab`,
`editorial-lab` and `gsap-motion-lab`; the Studio’s **AGENT API v1** panel audits any of them and
captures the exact current output frame. See [the agent API guide](./AGENT-API.md).

Release validation after M9: **41 test files / 277 tests passed**, all workspaces typechecked with zero
Svelte errors or warnings, and all frontend/example production builds completed. Browser acceptance
also verified source/HMR/Undo round trips, normalized helper-unroll frame equivalence, exact
random-access GSAP/path state, and two identical SHA-256 PNG captures of the same requested frame.

## 1. Executive summary

HyperFrames is currently the stronger general-purpose HTML-to-video product. It has a substantially
deeper direct-manipulation Studio, GSAP-aware animation editing, agent tooling, render formats,
deterministic headless rendering, parallel rendering, and cloud infrastructure.

FrameDiff should not respond by becoming a smaller copy of HyperFrames. Its defensible direction is a
different end-to-end system:

> A Git-native generative post-production workspace where source code, raw media, generated takes,
> reusable compositions, bakes, grades, cameras, motion, and final output share one reproducible project
> model.

The requested editing features are still important, but they should be implemented as projections over
that production system rather than as isolated Studio conveniences. A canvas move should be the same
kind of project mutation as a timeline trim, a keyframe edit, an agent edit, or a materialized generator
result. It should immediately update source, invalidate affected fingerprints, preserve asset
provenance, survive HMR, appear in Git, and produce the same preview and export.

The recommended program is approximately **20–24 engineer-weeks**, or **11–14 calendar weeks with two
experienced engineers**. A useful first release containing direct manipulation, rich visual controls,
stable lanes, real source trims, and undo/redo should be possible after roughly **5–7 weeks**.

## 2. Audit basis and scope

The comparison uses the current `main` branches inspected on 2026-07-15.

FrameDiff validation at the audited commit:

- `npm test`: 33 test files and 230 tests passed.
- `npm run typecheck`: all workspaces passed with zero Svelte errors or warnings.
- Worktree was clean and already current with `origin/main`.

HyperFrames validation at the audited commit:

- The documented build completed successfully with the current Bun runtime.
- Representative engine, producer, and SDK mutation suites passed serially.
- A full all-package parallel test run exceeded the available machine resources and produced timeout
  failures rather than assertion failures, so this report does not treat that run as a product defect.

This is a source, architecture, product-surface, and validation comparison. It is not an apples-to-apples
render-speed or visual-quality benchmark.

Primary HyperFrames references:

- [HyperFrames repository](https://github.com/heygen-com/hyperframes)
- [HyperFrames developer overview](https://hyperframes.video/developers)
- [Deterministic rendering](https://hyperframes.video/docs/concepts/deterministic-rendering)
- [Frame adapters](https://hyperframes.video/docs/concepts/frame-adapters)
- [CLI reference](https://hyperframes.video/docs/reference/hyperframes-cli)
- [AI-agent workflow](https://hyperframes.video/docs/recipes/ai-agents)
- [Manual DOM editing at the audited commit](https://github.com/heygen-com/hyperframes/blob/35e623b4f3502a88945750955000f59526a62ed3/docs/contributing/studio-manual-dom-editing.mdx)
- [Timeline editing at the audited commit](https://github.com/heygen-com/hyperframes/blob/35e623b4f3502a88945750955000f59526a62ed3/docs/guides/timeline-editing.mdx)
- [Keyframes at the audited commit](https://github.com/heygen-com/hyperframes/blob/35e623b4f3502a88945750955000f59526a62ed3/docs/guides/keyframes.mdx)
- [Rendering at the audited commit](https://github.com/heygen-com/hyperframes/blob/35e623b4f3502a88945750955000f59526a62ed3/docs/guides/rendering.mdx)

## 3. Product comparison

| Area | FrameDiff | HyperFrames | Current advantage |
| --- | --- | --- | --- |
| Source model | Plain HTML/CSS/JavaScript plus optional setup modules | Plain HTML/data attributes plus JavaScript/GSAP conventions | Broad parity |
| Timing | Integer composition frames, negative staging, explicit render window | Primarily seconds-based HTML/GSAP placement | FrameDiff for NLE-style timing |
| Preview/export | Pure browser-local WebCodecs/WebGPU path | Browser preview plus headless Chromium/FFmpeg production path | Different strengths |
| Canvas editing | Timeline selection and attribute Inspector; no preview hit-testing or transform handles | DOM hit-testing, overlays, move/resize, text and style editing | HyperFrames |
| Rich properties | Runtime supports several attributes, but controls are mostly number/text/boolean inputs | Rich typography, fills, gradients, asset fills, flex, blend and direct text editing | HyperFrames |
| Timeline | Frame-native move/trim, snapping, render window and negative pre-roll | Horizontal/vertical moves, stacking, multi-drag, collision logic and source-aware trim | HyperFrames overall |
| Animation | Arbitrary `onFrame`, interpolation, springs, camera keyframes; mostly code-edited | GSAP timeline registration, tween/keyframe editing, easing, arcs and gesture capture | HyperFrames |
| Computed animation | Computed values are generally read-only | Supported helper patterns can be unrolled into explicit editable operations | HyperFrames |
| Generation | First-class recipes, model settings, references, price estimates, immutable takes, pins, stale hashes and provenance | Generation is not the central composition/project abstraction | FrameDiff |
| Media identity | `asset://`, manifest, content-addressed cache, readable cache names, bakes and generated takes | Strong media tooling and caches, but runtime compositions remain more path-oriented | FrameDiff for project-wide coherence |
| Video post-production | Built-in WebGPU grade/LUT/bloom/vignette, 3D video planes, DoF and named cameras | Broad visual adapters, but less opinionated around this post-production stack | FrameDiff |
| Project collaboration | Private GitHub App, local-folder pull/push/checkpoint and conflict-safe branch updates | Git-friendly project layout, without the same productized repository control plane | FrameDiff |
| Determinism | Exact frame lifecycle and browser export; custom GPU capture seam | Stubbed clocks/randomness, BeginFrame control, pinned fonts, Docker and FFmpeg | HyperFrames |
| Output formats | Browser-supported WebCodecs/MP4 path | MP4/MOV/WebM/GIF/image sequences, HDR, alpha and broad codec support | HyperFrames |
| Parallel/cloud render | Deliberately deferred | Local workers, batch rendering, AWS, GCP and hosted cloud | HyperFrames |
| Agent workflow | Agents can edit the repo; limited first-party inspect/check/render surface | Dedicated CLI, JSON output, skills, lint/check/inspect/snapshot/render and media tools | HyperFrames |
| Adapter ecosystem | Native HTML, WebGPU, Three.js and focused effects | GSAP, Lottie, Three.js, Rive, WAAPI, D3, PixiJS, Anime.js and custom adapters | HyperFrames |
| Maturity | Small, early codebase and limited public packaging | Much larger public repository, community, test surface and Apache-2.0 license | HyperFrames |

## 4. Where FrameDiff is genuinely better

### 4.1 Generative video is part of the project model

FrameDiff treats generation as durable source-backed production state rather than a disposable tool
invocation. Recipes, references, model parameters, historical takes, pins, recipe hashes, costs and
provenance are connected to the same asset and composition system used downstream.

That enables workflows such as:

1. Build a deterministic 3D previz composition.
2. Bake it to a content-addressed artifact.
3. Use the artifact as a video-generation reference.
4. Preserve every generated take.
5. Pin one take for downstream editing.
6. Detect that the take is stale when its recipe or inputs change.
7. Grade, trim, composite and render the pinned result.

This is a stronger foundation for generative post-production than treating generation as a separate
CLI or media utility.

### 4.2 Browser-local private rendering

FrameDiff can preview and export entirely in the browser with WebCodecs and WebGPU. For quick local
iteration and private media, this is a meaningful product property: no Node process, Docker image,
FFmpeg installation, worker farm or upload is required.

HyperFrames has the stronger production renderer, but it also carries more runtime and deployment
surface. The best long-term FrameDiff design may offer that style of renderer as an optional backend
without giving up the local browser path.

### 4.3 One asset identity across imports, bakes and generated takes

FrameDiff's `asset://` identifiers, manifest, content hashes and shared CAS create a coherent project
ABI. Imported footage, browser-compatible proxies, nested bakes and generative takes can all be
referenced and verified through the same identity system.

HyperFrames also uses content-addressing in parts of its media tooling, so content-addressing alone is
not unique. FrameDiff's advantage is making it the connective tissue of the runtime, generation,
baking, collaboration and reproducibility story.

### 4.4 Specialized post-production primitives

FrameDiff has a focused stack for grading and dimensionalizing footage:

- WebGPU color grade and LUT processing
- Bloom and vignette
- Exact source-video frame selection
- 3D video planes
- Virtual cameras and cuts
- Depth of field
- Three.js scene integration

HyperFrames has a broader adapter ecosystem. FrameDiff has the more coherent specialized path from
source footage through grade, camera treatment, bake and final composite.

### 4.5 Git and collaboration are product features

FrameDiff's hosted design treats the customer's repository as the source project, uses a GitHub App,
avoids force-push, detects stale base commits, and keeps large media in content-addressed storage.

That is more than being compatible with Git. It is a collaboration and synchronization control plane
designed around creative projects.

### 4.6 Frame-native editorial ergonomics

FrameDiff's integer frame model, negative pre-roll/staging space and explicit render window are closer
to an NLE than a seconds-first web animation API. This advantage should be preserved while adding GSAP
support: the Studio should display and author frames even when an adapter converts them to seconds at
runtime.

## 5. Where HyperFrames is better

### 5.1 Direct-manipulation Studio

HyperFrames has the clearest current lead here. Its Studio can inspect preview DOM, select elements,
move and resize them, make elements movable, edit text, control typography, manipulate fills and
gradients, choose image fills, adjust flex layout, and edit opacity, radius and blend behavior.

FrameDiff already understands several underlying properties but lacks the preview geometry and typed
control architecture that turns them into an integrated visual editor.

### 5.2 Animation authoring

HyperFrames' GSAP conventions create a constraint, but that constraint makes animation mechanically
editable. The Studio can expose tween/keyframe diamonds, property and ease controls, arc paths, gesture
recording, and helper unrolling.

FrameDiff's unrestricted `onFrame()` is more general and naturally deterministic in frame time, but a
GUI cannot safely infer arbitrary JavaScript semantics. FrameDiff needs a canonical editable motion
subset while retaining arbitrary code as an opaque escape hatch.

### 5.3 Deterministic production rendering

HyperFrames controls browser time, randomness and frame advancement, can use Chromium's BeginFrame
path, pins fonts and runtime images, and composes a Docker/FFmpeg production environment. This is a
stronger approach for reproducible CI and cloud output than relying primarily on the interactive
browser runtime.

### 5.4 Formats, codecs, parallelism and cloud

HyperFrames supports more containers, codecs, alpha, HDR, image sequences, worker parallelism, batch
jobs and cloud providers. FrameDiff's browser renderer is simpler and private, but cannot match the
format breadth of an FFmpeg-backed pipeline.

### 5.5 Agent tooling

HyperFrames gives agents stable commands and machine-readable output for initialization, inspection,
linting, checking, snapshots, rendering, catalog discovery, captions, transcription, TTS, media use and
cloud operations.

FrameDiff's code-first model is agent-friendly in principle, but it needs a first-party inspection and
mutation protocol so agents use the same project semantics as the Studio rather than scraping source
or inventing private workflows.

### 5.6 Ecosystem and maturity

HyperFrames is substantially larger, has more integrations, more contributors, more tests, more
documentation, clearer licensing and more public adoption. FrameDiff should assume HyperFrames will
continue improving quickly.

## 6. Strategic conclusion

The generic message "plain HTML video that agents can edit" is no longer enough differentiation.
HyperFrames is already very strong there.

FrameDiff should position around the entire production lineage:

```text
idea/doc/previz
  -> source media and asset identity
  -> generation recipes and immutable takes
  -> nested compositions and reusable looks
  -> visual editing, timing and motion
  -> deterministic bake/render
  -> Git diff and project commit
  -> content-addressed sync and collaboration
```

The Studio is one view over that lineage. Code editors, agents, custom project views and future hosted
collaboration surfaces should use the same query, inspection and edit contracts.

## 7. FrameDiff-native implementation principles

### 7.1 One identity across every surface

Every selectable project object should have a stable semantic identity:

```ts
interface ProjectObjectRef {
  compositionKey: string;
  objectId: string;
  kind: "element" | "clip" | "effect" | "animation" | "asset" | "artifact" | "generator";
}
```

Canvas, timeline, Inspector, code panel, generation workbench, cache drawer and agent inspection should
refer to this identity. Selection should no longer mean only `selectedItemId`.

### 7.2 One derived project snapshot

The Studio may build a rich in-memory read model, but it must always be derived from project source,
manifests, lockfiles, runtime inspection and artifact metadata. It is never a second persisted scene
document.

Each property snapshot should carry:

- Current value
- Control schema
- Source file and span
- Authority: literal, shared, computed or opaque
- Animation binding, when present
- Referenced asset and content hash, when present
- Fingerprint consumers affected by the value
- Local/remote sync state where relevant

### 7.3 One semantic edit path

All reversible project edits go through one transaction protocol. A canvas drag, trim, lane reorder,
gradient edit, keyframe move, agent mutation and unroll operation are all semantic edit commands that
compile to revision-checked source patches.

Paid generation submissions, uploads, renders and Git commits remain explicit external operations and
are not treated as ordinary undoable edits. Recipe edits and asset-reference assignments are undoable;
submitting a paid job is not.

### 7.4 One animation binding model, multiple source adapters

The Studio should reason about a frame-native binding model:

```ts
type ParamBinding =
  | { kind: "const"; value: unknown }
  | { kind: "keyframes"; keys: Keyframe[] }
  | { kind: "spring"; from: number; to: number; config?: SpringConfig }
  | { kind: "expr"; code: string }
  | { kind: "link"; ref: ProjectObjectRef };
```

This is a derived editing abstraction, not a new persisted authority. Adapters can project HTML
attributes, GSAP calls, camera arrays and declared editable data into bindings. The UI then has one
answer to "is this property static, keyframed, computed, linked or opaque?"

### 7.5 Edits propagate through the production graph

After every successful edit:

1. HMR refreshes the mounted composition.
2. The project snapshot is re-derived.
3. Fingerprints identify affected bakes and generated inputs.
4. Stale artifacts are surfaced on the relevant clip/node.
5. Git status reflects the source change.
6. Asset synchronization status remains attached to referenced content hashes.
7. Preview and final render continue to use the same runtime behavior.

That propagation is what makes the new editing features part of FrameDiff rather than a separate web
design tool embedded inside it.

## 8. End-to-end implementation program

### Milestone 0 — Contract and risk spikes

**Effort:** 1–1.5 engineer-weeks.

Decide and document:

- Project-object identity and selection
- Property provenance and authority
- Semantic edit transaction and history receipts
- Studio-editable HTML property ABI
- Frame-native animation binding snapshot
- Canonical GSAP subset
- Unroll safety and validation rules

Build two spikes before full implementation:

1. Select and resize a scaled/rotated preview node, commit through the edit transaction, survive HMR,
   and produce an exact Git diff.
2. Trace one helper-generated GSAP animation and replace only its call site with equivalent explicit
   tweens whose normalized trace is identical.

**Exit gate:** both risky seams work without adding a persistent parallel scene model.

### Milestone 1 — Project edit kernel and history

**Effort:** 2–3 engineer-weeks.

Add `EditManager` and `HistoryManager` to the Studio model. Define commands, source mutations, revision
hashes, inverse receipts, grouping and conflict behavior.

Add a transactional Vite bridge endpoint that validates all base revisions before writing any file.
Multi-file commands should complete atomically.

Migrate existing reversible writes:

- Placement changes
- Render window
- Inspector attributes
- Grade presets
- Recipe parameter edits
- Composition property edits

History behavior:

- One pointer or slider gesture equals one history entry.
- Multi-property and multi-file changes stay grouped.
- Undo restores exact previous bytes.
- Redo restores exact edited bytes.
- An external edit causes a visible conflict instead of being overwritten.
- History survives composition HMR/remount within the Studio session.

Expose the same semantic edit endpoint to a future CLI/MCP surface; do not make it GUI-private.

**End-to-end proof:** Inspector edit -> source patch -> HMR -> fingerprint refresh -> Git status -> undo.

### Milestone 2 — Unified selection and direct manipulation

**Effort:** 2–3 engineer-weeks.

Extend the preview port with plain node snapshots, hit testing, geometry subscription and ephemeral
draft styling. Authored DOM nodes remain private to the runtime.

Add a canvas overlay with:

- Stable-element selection
- Owning clip/composition context
- Nested-composition drill-in
- Move and resize handles
- Keyboard nudging
- Axis/aspect modifiers
- Parent/sibling snapping guides
- Cancelable live drafts
- Explicit "Make movable" materialization

The overlay should never enter exported composition pixels. Pointer movement should write no source;
pointer-up commits one command.

Selection should synchronize across canvas, timeline, Inspector and code view. A selected generated or
baked clip should also expose its pinned take, source artifact, fingerprint and stale state rather than
appearing as an anonymous DOM element.

**End-to-end proof:** select a generated-take clip on canvas -> inspect its asset/take provenance ->
move it -> source/HMR/Git update -> undo -> exact restoration.

### Milestone 3 — Schema-driven visual properties and asset fills

**Effort:** approximately 2 engineer-weeks.

Replace the optional number/text/boolean Inspector field with a typed control union covering:

- Number/slider
- Text/multiline text
- Boolean
- Color
- Enum/button group
- Font and typography
- Asset selection
- Gradient stops
- Alignment
- Vector/padding controls

Add controls for:

- Text content and direct text editing
- Font family, weight, style, size, line height and letter spacing
- Alignment, decoration and case
- Solid, linear and radial fills
- Gradient angle and stops
- `asset://` image fills, fit and position
- Flex direction, wrap, justify, alignment, gap and padding
- Opacity, radius, blend mode and isolation

Use readable `data-fd-*` attributes as the first-party authored ABI. Keep arbitrary CSS as a supported
but read-only escape hatch until the user explicitly materializes a value.

Asset fills must select manifest assets and persist `asset://` references. They must not persist local
cache URLs. Assigning an existing asset is undoable; importing/uploading bytes remains a separate
explicit operation.

**End-to-end proof:** import/choose an image -> set it as a fill -> resolve its content hash -> preview
and export -> show whether the asset is local/pinned/remote -> commit the source and manifest reference.

### Milestone 4 — Editorial lanes, stacking and source-true trimming

**Effort:** 2–3 engineer-weeks.

Introduce a stable visual-layer authority such as `data-fd-layer`. Map it to runtime stacking while
preserving DOM order as the legacy fallback. Keep descendant `data-fd-z-index` separate from timeline
clip layers.

Replace overlap-derived ephemeral lanes with stable lane snapshots. Vertical drag/drop should rewrite
layer authority atomically, including normalization of affected ranks. Collision behavior must never
silently change horizontal timing.

Normalize time units:

- Placement: owning-composition frames
- Media/nested in-point: source seconds
- UI: owning-composition frames/timecode
- Asset duration: seconds from metadata
- Nested duration: child frames converted using child FPS

Real front trim uses:

```text
deltaFrames = newFrom - oldFrom
newDuration = oldDuration - deltaFrames
newTrimStartSeconds =
  oldTrimStartSeconds + deltaFrames / compositionFps * playbackRate
```

Right trim changes duration only. Source limits should use actual media metadata and playback rate.

Timeline clips should also surface production state:

- Raw/proxy/full-resolution asset availability
- Pinned generated take
- Bake current/stale/missing/remote status
- Referenced nested composition
- Grade/effect presence

**End-to-end proof:** pull a proxy-only source -> front-trim without changing the surviving source frame
-> move it to a different visual layer -> render with full-resolution media -> commit/push source and
content references.

### Milestone 5 — Frame-native motion adapter with GSAP support

**Effort:** 2–3 engineer-weeks.

Add an optional `framediff/gsap` adapter. All GSAP may run, but only a documented registered subset is
guaranteed to round-trip through the Studio.

Recommended source shape:

```ts
defineGsapTimeline(({ gsap, frames }) => {
  const timeline = gsap.timeline({ paused: true });
  timeline.fromTo(
    '[data-fd-id="title"]',
    { x: 0, opacity: 0 },
    { x: 320, opacity: 1, duration: frames(30), ease: "power2.out" },
    frames(10),
  );
  return timeline;
});
```

`frames(n)` preserves FrameDiff's integer-frame authoring while the adapter converts to GSAP time.
Every render frame seeks the paused timeline absolutely; no wall-clock progression is allowed.

Create a real JavaScript/TypeScript AST source analyzer for registered timelines. Initially recognize
literal targets, `to`, `from`, `fromTo`, `set`, literal vars, ease names, `frames(integer)`, numeric
seconds and explicit keyframe arrays.

Project recognized operations into the shared `ParamBinding` snapshots. Arbitrary `onFrame()` and
unrecognized GSAP remain valid but opaque.

**End-to-end proof:** agent or human adds a registered tween in source -> Studio shows its binding and
keys -> preview/export seek the same absolute frame -> source fingerprint participates in downstream
bakes.

### Milestone 6 — Tween and keyframe editing

**Effort:** 2–3 engineer-weeks.

Add:

- Animatable-property stopwatch
- Add/update key at the playhead
- Previous/next key navigation
- Timeline diamonds and property lanes
- Move, edit, ease and delete keyframes
- Static-to-tween conversion
- Auto-key, off by default
- Canvas manipulation routed to the current key when animation owns the property

The UI stays frame-native. Source writers update `frames(n)` or carefully convert existing seconds.
Implicit starts, shared values and computed timing must be labeled rather than silently materialized.

Keyframe source edits should immediately mark dependent bakes/artifacts stale and keep the selected
object stable through HMR.

**End-to-end proof:** edit the motion of a nested generated clip -> preview it -> see affected bake
fingerprints become stale -> rebake -> downstream composition consumes the new content hash.

### Milestone 7 — Arc motion and gesture recording

**Effort:** 2–3 engineer-weeks.

Add motion-path snapshots compatible with the binding and GSAP adapter. The canvas should display path
anchors, tangents, key positions and element ghosts.

Provide:

- "Make arc" between two position keys
- Curvature and direction controls
- Direct Bézier handle editing
- Gesture recording during paused or live playback
- Composition-coordinate sampling
- One sample per frame at most
- Jitter filtering, simplification and cubic fitting
- Preview-before-commit
- One grouped undo entry

Gesture results should be deterministic with respect to composition frames rather than browser pointer
event frequency.

**End-to-end proof:** record a path over a generated product shot -> simplify it -> render identically
after HMR -> include the motion source in Git and any dependent bake fingerprints.

### Milestone 8 — Materialize and unroll to edit

**Effort:** 3–4 engineer-weeks and the highest schedule risk.

Do not attempt to understand arbitrary JavaScript statically. Combine AST call-site locations with the
runtime trace produced by the registered animation adapter.

Flow:

1. Identify the helper call or loop responsible for an opaque animation group.
2. Capture the finite normalized tween operations produced by that call.
3. Verify targets, values, times, easing and plugins are serializable.
4. Replace only the call-site statement with explicit canonical operations.
5. Reload through HMR.
6. Compare normalized pre/post traces and sampled frames.
7. Roll back automatically if behavior differs.

Support fixed helper calls, loops over fixed arrays, stagger helpers and resolvable relative positions.
Refuse callbacks, randomness, DOM measurement, unstable selectors, unknown plugins and external side
effects.

The same UX language should apply outside GSAP:

- A computed numeric property can be materialized as an explicit override.
- A shared value offers "edit all" or "fork here."
- A generated artifact can be pinned/materialized for downstream editing.
- A generated doc can be materialized into a source document.

This gives FrameDiff one consistent transition from derived/opaque state into explicit editable source.

**End-to-end proof:** unroll a helper -> identical trace and frames -> edit resulting keys -> invalidate
only dependent artifacts -> undo back to the original helper call.

### Milestone 9 — Agent, collaboration and release hardening

**Effort:** approximately 2 engineer-weeks, overlapping earlier milestones.

Expose the derived project snapshot and semantic edit commands through machine-readable inspection and
mutation endpoints suitable for CLI/MCP use. Agents should not need to reverse-engineer HTML attributes
that the Studio already understands.

Add:

- `inspect` snapshots with IDs, bindings, source authority, asset hashes and stale states
- `check` for unsupported/opaque editing constructs
- `snapshot` for visual feedback
- Semantic edit commands using the same transaction/history compiler
- Clear source-conflict and stale-base diagnostics

Test layers:

- Source parser/writer and idempotency tests
- History, grouping and conflict tests
- Browser interaction and HMR tests
- Fractional-FPS and media-trim tests
- Golden preview/export frames
- Fingerprint and stale-propagation tests
- Local/remote asset-state tests
- Agent edit -> Studio reflection tests

Performance gates:

- No source writes during pointer movement
- 60 FPS draft interaction on representative compositions
- Incremental geometry and source inspection
- Bounded gesture/path serialization
- No re-generation or re-bake unless fingerprints actually change

## 9. Release cuts

| Release | Milestones | End-to-end user outcome |
| --- | --- | --- |
| Project edit kernel | 0–1 | One reversible, conflict-safe edit path shared by Studio and future agents |
| Direct production editing | 2–4 | Select, move, resize, style, assign assets, layer and source-trim while preserving Git/provenance/render behavior |
| Motion production | 5–6 | Frame-native GSAP/tween/keyframe editing connected to preview, export and stale artifacts |
| Materialized motion | 7–8 | Arc paths, gesture capture and safe conversion from computed helpers to explicit source |
| Collaborative release | 9 | Agents, humans and hosted sync operate on the same project identities and mutations |

## 10. Suggested staffing and schedule

With two experienced engineers:

- Weeks 1–3: contracts, transaction endpoint, history and migration of existing edit writes.
- Weeks 3–7 in parallel: one engineer on selection/Inspector/assets and one on timeline/media trim.
- Weeks 7–10: animation adapter and keyframe UX.
- Weeks 10–13: motion paths and unroll.
- Weeks 12–14: agent surface, golden tests, examples and compatibility hardening.

The direct-manipulation release should not wait for unroll. Unroll is valuable but high-risk and can
ship after canonical tween/keyframe editing is solid.

## 11. Suggested implementation boundaries

Likely changes and additions:

- `packages/studio-model/src/types.ts`
  - Project-object identity, selection, typed controls, authority, binding and animation snapshots.
- `packages/studio-model/src/managers/EditManager.ts`
  - Semantic commands, grouping and optimistic transaction state.
- `packages/studio-model/src/managers/HistoryManager.ts`
  - Exact inverse receipts, conflict-safe undo and redo.
- `packages/studio-model/src/StudioApplication.ts`
  - Manager wiring and shared edit surface.
- `packages/framediff/src/studio-runtime/runtime.ts`
  - Preview inspection, edit compilation, property and animation snapshots.
- `packages/framediff/src/runtime.ts`
  - New first-party visual properties, layer authority, image-fill resolution and animation adapter hooks.
- `packages/framediff/src/studio/htmlSource.ts`
  - Formatting-preserving property mutation and materialization support.
- `packages/framediff/vite-plugin.ts`
  - Atomic revision-checked edit endpoint.
- `packages/source-edit/`
  - New server-side AST analysis/writing package for JavaScript/TypeScript and GSAP.
- `packages/framediff/src/gsap/`
  - Registered deterministic adapter and normalized trace.
- `packages/studio-ui/src/views/CanvasOverlay.svelte`
  - Selection, geometry, handles, snapping, motion paths and gesture drafts.
- `packages/studio-ui/src/views/Inspector.svelte`
  - Schema-driven controls and property authority UX.
- `packages/studio-ui/src/views/Timeline.svelte`
  - Stable layers, vertical dragging, source trim and animation lanes.

## 12. Non-goals and guardrails

- Do not create a second persisted JSON scene document.
- Do not attempt arbitrary CSS stylesheet rewriting in the first release.
- Do not claim arbitrary `onFrame()` JavaScript is visually editable.
- Do not make GSAP the only animation model; it is one source/runtime adapter into frame-native bindings.
- Do not write source on every pointer event.
- Do not hide computed/shared/opaque authority behind apparently editable fields.
- Do not make agent mutations a separate path from Studio mutations.
- Do not treat generation submission, upload, render or Git commit as ordinary undo operations.
- Do not lose FrameDiff's browser-local render path while adding an optional production renderer later.
- Do not rebuild HyperFrames' codec/cloud stack before deciding whether it can be integrated or used as
  an optional backend.

## 13. Definition of success

The gap is closed in a FrameDiff-native way when this complete loop works:

1. A collaborator pulls a project and its referenced media by content hash.
2. They select a generated or raw clip in the preview.
3. They move, resize, restyle, layer, trim and animate it visually.
4. Every interaction becomes a small readable source diff.
5. Undo/redo and manual/agent edits coexist without overwriting external changes.
6. The Studio immediately shows which takes, bakes or outputs became stale.
7. Preview and export evaluate the same frame state.
8. Rebuilt artifacts receive new content hashes and downstream consumers update reproducibly.
9. Source, manifest and lock changes are committed to Git.
10. Another collaborator or agent pulls the same project and sees the same assets, animation, preview
    and output lineage.

That result is more valuable than feature parity by itself: it turns direct manipulation and motion
editing into the front end of FrameDiff's complete production, provenance and collaboration system.
