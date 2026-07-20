# FrameDiff Studio editing contracts

> This is the mutation/provenance contract beneath the canonical
> [FrameDiff architecture](./ARCHITECTURE.md).

Status: accepted for the M0–M9 gap-closure program.

These contracts keep the Studio an end-to-end projection of authored FrameDiff projects. Source,
assets and registered runtime behavior remain authoritative; the editor does not create a second
persistent scene model.

## Identity and selection

Every editable object has a `ProjectObjectRef`: composition key, stable object ID and object kind.
First-party HTML elements use `data-fd-id`; sequence/media clips keep their authored ID. Canvas,
timeline, Inspector, animation, agent and provenance APIs exchange this identity instead of DOM nodes.
Nested content stays owned by its composition until the user drills into that composition.

## Property provenance

Every projected property reports one authority:

- `literal`: FrameDiff can rewrite the authored literal safely.
- `shared`: the value comes from a named shared binding; editing it may affect multiple consumers.
- `computed`: the value is derived code and needs an explicit unroll operation before direct editing.
- `opaque`: the source/runtime adapter cannot safely analyze it.

An editable snapshot also identifies its source span, control schema, animation binding, referenced
asset/content hash and affected fingerprint consumers when those exist. Unknown CSS and arbitrary
`onFrame` code keep working, but remain read-only until explicitly materialized.

## Editable HTML ABI

Readable `data-fd-*` attributes are the first-party source ABI. Stable IDs and clip placement remain
separate from visual element properties. Visual coordinates are authored in composition pixels;
preview scale/rotation is inverted before drafts or source edits are produced. The overlay never
becomes composition content and pointer movement never writes source.

## Semantic edits and history

All reversible edits compile to one revision-checked `/__framediff/edit` transaction. The server
validates every base hash before touching any file, applies all file replacements as one transaction,
and returns exact before/after byte snapshots. A gesture supplies one `groupId`, so history stores one
entry even if it emits intermediate source commits. Undo and redo replay exact bytes and refuse to
overwrite external changes.

Generation submission, asset upload, render and Git operations are explicit external effects rather
than ordinary undo entries. Editing a recipe or assigning an existing `asset://` reference is an
ordinary reversible source edit.

## Frame-native animation

The editor projects recognized sources into `ParamBinding` (`const`, `keyframes`, `spring`, `expr` or
`link`). The projection is derived; source stays authoritative. `onFrame` remains the master runtime
primitive. The optional GSAP adapter registers a paused timeline and seeks it absolutely to
`frame / fps` for preview and render.

The round-trippable GSAP subset is literal targets, `to`, `from`, `fromTo`, `set`, literal vars,
declared ease names, integer `frames(n)`, numeric seconds and literal keyframe arrays. Timelines,
ticker/autoplay, callbacks, wall-clock reads and unseeded randomness may execute outside Studio
editing but are not promised deterministic round-trip behavior.

Normalized traces preserve operation order, target, frame timing, property values and ease. Helper
unrolling is accepted only when the before/after traces match.

## Unroll safety

“Unroll to edit” is a previewed source transformation, never an implicit fallback. It must:

1. Resolve one call site and its helper without dynamic dispatch.
2. Preserve evaluation order and supported values.
3. Change only the requested call site unless the user explicitly chooses a shared rewrite.
4. Produce an identical normalized animation/property trace.
5. Parse, typecheck and pass the relevant deterministic preview probe before commit.
6. Commit through the normal edit transaction as one undoable operation.

If any proof fails, the property remains computed and FrameDiff explains the unsupported construct.

## Production propagation

After a successful edit, HMR re-derives the project snapshot. Source fingerprints update, dependent
bakes/artifacts become current or stale, Git sees the exact source diff, referenced assets retain
local/pinned/remote state, and preview/export continue through the same browser-local runtime. LUTs,
WebGPU, Three.js and arbitrary `onFrame` behavior are preserved.
