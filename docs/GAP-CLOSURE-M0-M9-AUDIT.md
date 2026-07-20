# FrameDiff gap-closure release audit — M0 through M9

> Audited: 2026-07-15
> Branch: `codex/gap-closure-m0-m9`
> Baseline: `929ffcf` (`main`)
> Result: all planned milestones are implemented as one source-backed, frame-native system

This is the release evidence for the implementation program in
[the FrameDiff vs. HyperFrames gap-closure plan](./FRAMEDIFF-VS-HYPERFRAMES-GAP-CLOSURE-PLAN-2026-07-15.md).
The implementation deliberately does not introduce a persisted editor scene graph. Studio state is a
derived view of authored source, assets, runtime inspection and content-addressed artifact metadata.

## Release result

| Milestone | User outcome | Implementation evidence | Verification evidence |
| --- | --- | --- | --- |
| M0 · Contracts and spikes | Objects have stable identity, every property exposes authority, and risky canvas/unroll seams have an explicit contract. | `docs/STUDIO-EDITING-CONTRACTS.md`, `docs/M0-FINDINGS.md`, `docs/M0-SPIKE.md`; plain snapshot contracts in `packages/studio-model/src/types.ts`. | Scaled/rotated geometry tests; exact HTML source rewrite tests; normalized helper trace test. Commit `03b14aa`. |
| M1 · Edit kernel and history | Every Studio or agent edit receives the same revision-checked atomic source transaction, receipt and Undo/Redo behavior. | Vite `/__framediff/edit` transaction bridge; `HistoryManager`; receipts and conflicts in `StudioSession` and runtime ports. | History grouping, exact byte replay, redo invalidation, conflict retention, session/HMR selection and agent-history tests. Commit `9afe7d3`. |
| M2 · Selection and canvas | A user can select, drill into nested content, move, resize, nudge, snap, edit text and materialize geometry without polluting export pixels. | Preview node/geometry/hit-test/draft port; `PreviewHost.svelte`; HTML `data-fd-*` writers. | Rotated transform and fixed-opposite-corner resize tests; stable canvas/Inspector selection tests; source-backed text/geometry tests; Direct Manipulation Lab. Commit `9a65789`. |
| M3 · Visual properties | Text, typography, solid/gradient/image fill, flex, opacity, radius, blend and isolation controls persist readable source. | Typed Inspector control union; `htmlSource` property schema and writers; asset picker persists `asset://`, never a cache URL. | Targeted descendant and same-name isolation tests; browser/HMR/Undo round trips; Rich Properties Lab. Commit `dbd12e4`. |
| M4 · Editorial production | Stable authored lanes control stacking; move and true front trim are atomic; clips expose media, proxy, take, nested and artifact state. | `data-fd-layer`; `frontTrimPlacement`; proxy/original locality checks; playback-rate/source-second trim; artifact input-hash status; production badges. | Persistent-lane, legacy fallback, playback-rate trim and artifact-staleness tests; browser badges for stale/missing nested bakes; Editorial Lab. Commits `f9e25cb` plus final hardening. |
| M5 · Frame-native GSAP | Familiar GSAP authoring is optional while preview/export remain exact, absolute and frame-driven. | `defineGsapTimeline`; paused absolute seeks; `frames(n)`; AST projection of the registered subset into shared animation bindings. | Absolute seek, trace serialization, opacity/transform and unsafe-source tests; repeated exact local PNG proof; GSAP Motion Lab. Commit `90726b8`. |
| M6 · Tween and key editing | Users can create tweens, add/move/edit/delete keys, change easing, navigate keys, auto-key and route canvas edits to animation-owned properties. | Animation mutation compiler; stopwatch and key controls in Inspector; diamonds/property lanes in Timeline; grouped animation command. | Source round-trip/idempotency tests; auto-key-off default; canvas-to-current-key and selection-through-refresh tests. Commit `61e6f6b`. |
| M7 · Paths and gestures | Position keys can become arcs; anchors/tangents are directly editable; recorded gestures preview and commit once. | Cubic path snapshots/writers; SVG canvas overlay; arc direction/curvature; frame sampler, jitter simplifier and deterministic cubic fitter. | Reversible arc, one-sample-per-frame and event-frequency-independent path tests; grouped gesture session test; path showcase in GSAP Motion Lab. Commit `6a2241e`. |
| M8 · Unroll to edit | A finite helper/loop/stagger result can become explicit editable source without guessing at arbitrary JavaScript. | AST-isolated `unroll()` boundary plus runtime GSAP trace; canonical explicit operations; normalized pre/post proof; refusal of randomness, callbacks, DOM measurements, unstable targets and unresolved stagger. | Call-site-only rewrite, trace-equivalence, nondeterminism and runtime-DOM refusal tests; browser trace/HMR/Undo proof. Commit `03a9cd1` plus final hardening. |
| M9 · Agent and hardening | Human and machine editors inspect and mutate the same project model with stable IDs, revisions, diagnostics, exact frames and shared history. | `StudioAgentApi` v1: `inspect`, `check`, `snapshot`, `execute`; complete dependency hashes; file races; asset/artifact state; visible top-bar panel. | Agent stale-base, atomic-race, front-trim/history and exact-frame tests; full workspace release matrix; browser API check and repeated exact PNG capture. Commit `a780bf9` plus final hardening. |

## End-to-end invariants

The implementation closes the product gaps without weakening FrameDiff's architectural advantages:

1. **One source of truth.** HTML/CSS/JS/TS, recipe documents, asset manifests and artifact sidecars are
   authoritative. Canvas, Inspector, timeline, code and agent surfaces compile to the same semantic
   source commands.
2. **One edit lifecycle.** A gesture is a live DOM/local-state draft, then one pointer-up command, one
   revision-checked write, one HMR reconciliation and one history entry. Cancellation clears the draft
   and performs no source write.
3. **One frame clock.** `onFrame`, registered GSAP, gesture sampling, preview, exact snapshot, nested
   playback and export all consume absolute composition frames. Registered GSAP never advances from
   wall-clock time.
4. **One production graph.** Declared source dependencies feed fingerprints. Source/key/path changes
   make only mismatched bakes stale; new bakes record exact input hashes and downstream content hashes.
5. **One identity model.** Stable composition, clip, element, animation, asset, take and artifact IDs
   survive HMR and are visible to both people and agents.

The no-write-during-drag gate is structural: canvas pointer movement calls only the runtime's
`applyDraft()` DOM hook, and timeline pointer movement changes only local view state. Their pointer-up
handlers dispatch one semantic edit. Geometry subscriptions are incremental, gesture samples are
bounded to one per frame before simplification, and bake/generation remain explicit fingerprinted
operations.

## Local rendering and specialized FrameDiff features

All gap-closure features remain browser-local. `snapshot()` and export use the existing
`captureCompositeFrame`/export path, including exact media-frame decode, nested compositions,
Three.js/WebGPU capture hooks, grade layers and LUT processing. Nothing in the GSAP adapter, edit
kernel or agent API requires cloud rendering. Cloud/CAS synchronization remains an optional production
and collaboration layer.

Arbitrary `onFrame()` code continues to work. Registered GSAP adds an editable compatibility surface;
it does not replace FrameDiff's exact random-access clock. Unregistered or computed animation remains
valid and previewable, but is labeled opaque/read-only until the user explicitly materializes or
unrolls it.

## Showcase routes

Run the hero example and open these compositions in Studio:

| Composition | Features demonstrated |
| --- | --- |
| `direct-manipulation-lab` | Selection, nested context, snapping, move/resize modifiers, live drafts and single-commit gestures |
| `rich-properties-lab` | Direct text, typography, solid/gradient/image fills, flex, opacity, blend and isolation |
| `editorial-lab` | Persistent visual layers, lane movement, real front trim, source limits and production-state badges |
| `gsap-motion-lab` | Frame-driven registered tweens, keys/eases, motion path, gesture recording and safe helper unroll |
| Any composition + **AGENT API v1** | Project inspection, editability diagnostics and exact current-frame PNG feedback |

## Final validation

- `npm test`: **41 files, 277 tests passed**.
- `npm run typecheck`: every workspace passed; Svelte checks reported **0 errors and 0 warnings**.
- `npm run build --workspaces --if-present`: frontend and all examples built successfully. The only
  output was the existing advisory about large bundles/dynamic chunking.
- In-app browser acceptance on `gsap-motion-lab`: Studio status **ready**; registered animation lanes,
  key diamonds and safe `helper-dots` trace visible; Agent API check **READY**.
- Exact browser-local frame capture at frame `0`, `1920×1080`, repeated twice with the same displayed
  hash prefix: `sha256:d9474a8690f71163…`.
- `git diff --check`: clean.

## Intentional guardrails

The release does not claim that arbitrary JavaScript is statically editable. Unknown callbacks,
randomness, runtime layout reads, unknown plugins and unstable selectors are refused for unroll. Raw
CSS and computed/shared values remain inspectable and renderable; users choose whether to materialize,
fork or edit all. This is the safety boundary that keeps source rewrites explainable, reversible and
deterministic.
