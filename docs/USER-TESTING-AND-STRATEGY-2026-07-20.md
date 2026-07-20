# FrameDiff user scenarios and testing strategy — 2026-07-20

This document is the reusable acceptance charter for FrameDiff Studio. It tests the product as a
code-first video editor rather than as a collection of isolated controls: every important workflow
must remain understandable in the GUI, addressable by an agent, source-backed, reversible, and exact
at preview/capture/render time.

## Personas and quality bar

| Persona | Starts with | Needs to trust |
| --- | --- | --- |
| First-time visual editor | A project URL and no knowledge of the source layout | Where to start, what is selected, what an edit will change, and how to undo it |
| Experienced editor | Timeline, media-bin, grading, motion, and render expectations | Precise timing, discoverable state, responsive feedback, and predictable delivery |
| Motion designer | A visual target and willingness to use code when useful | Stable canvas objects, frame-native motion, source authority, and random-access fidelity |
| Code author | HTML/CSS/TypeScript and Git | HMR continuity, readable diffs, deterministic output, and no hidden editor database |
| Agent/LLM | Repository access plus the agent API | Stable IDs, bounded semantic commands, revision conflicts, receipts, diagnostics, and exact snapshots |
| Reviewer/operator | A dirty working tree, cached artifacts, and an output request | What changed, whether inputs are current, and whether the render can be reproduced |

A workflow passes only when the user can discover it, complete it, observe a truthful success state,
undo it as one intent, and repeat it after refresh. For agent-capable workflows, inspect and execute
must share the same source authority and conflict behavior as the GUI.

## Scenario inventory

The `Automation` column is the minimum regression layer. `E2E` refers to
`tests/e2e/studio.smoke.spec.ts`; `manual` steps belong in a release or focused exploratory pass.

| ID | Scenario | Primary risks | Automation |
| --- | --- | --- | --- |
| S01 | Open an unfamiliar project and find its entry point | Blank/ambiguous first state, missing assets, unclear terminology | E2E + typecheck |
| S02 | Search a large composition graph | Duplicate views, hidden nesting, no-result dead ends | Unit + E2E |
| S03 | Follow the project Guide into a real edit | Tutorial divorced from state, wrong frame/object/panel | E2E |
| S04 | Select, move, resize, and edit one canvas object | Scaled-coordinate errors, selection loss, partial writes | Unit + integration + manual pointer pass |
| S05 | Refresh/HMR while focused on an element or animation | Inspector broadens to owner clip, context disappears | Unit + E2E |
| S06 | Find and inspect media in a large bin | Unscrollable list, expensive hunting, lost provenance | Unit + E2E |
| S07 | Trim and move timeline clips | Off-by-one frames, source-in drift, stacking surprises | Unit + manual pointer pass |
| S08 | Edit keys, easing, paths, and recorded gestures | Forward-only state, ungrouped writes, unsafe unroll | Unit + manual visual pass |
| S09 | Compare grade/LUT bypass | Non-discoverable shortcut, preview/export disagreement | Unit + manual snapshot comparison |
| S10 | Inspect imported 3D camera state | Raw parameter overload, bad lens/pose coupling | Unit + manual visual pass |
| S11 | Review and apply generative takes | Accidental spend, mutable provenance, unclear pin state | Unit + manual provider-sandbox pass |
| S12 | Inspect cache and stale artifacts | Duplicate noise, no way to find an artifact, stale delivery | Unit + E2E |
| S13 | Use the guarded agent workflow | Unstable IDs, stale-base overwrite, noisy diagnostics | Unit + E2E |
| S14 | Undo/Redo GUI and agent edits | Partial transaction, source race, lost selection | Unit + integration + manual mixed-author pass |
| S15 | Work at a compact desktop width | Clipped render controls, inaccessible side panel | Unit + E2E at 900×700 |
| S16 | Create/duplicate/nest/delete a composition | Surprise placement, orphan files, destructive misclick | Integration + manual isolated-fixture pass |
| S17 | Preflight and render a local MP4 | Missing media, stale bakes, range/audio ambiguity | Render unit tests + manual release pass |
| S18 | Recover from malformed or external source edits | Silent failure, stale UI, destructive overwrite | Unit + integration + manual conflict pass |

## Detailed user charters

### S01–S03: orientation, discovery, and guided work

1. Start the Production Lab with no saved browser state.
2. Confirm the project entry point, current composition, source file, render window, timeline lanes,
   Guide progress, Git state, agent check, cache, and render action are visible or one clear action away.
3. Search compositions by user-facing name, stable key, kind, source path, and a feature term.
4. Search for a nonexistent term and recover without reloading.
5. Start the Guide, complete a step, and confirm the next step navigates to the declared composition,
   frame, stable selection, and panel.
6. Switch among Properties, Code, Media, and Guide; the active guided task must remain in context.

Pass condition: a new user can explain what they are editing and how to get back to the starting
composition without opening source code.

### S04–S05: direct manipulation and continuity

1. Use the Guide to select `move-card`; verify the Inspector shows one element, not every child of its
   owning timeline item.
2. Move and resize it at a scaled preview size. Repeat with Shift and Alt modifiers.
3. Edit a numeric property, then a text property. Confirm each creates a readable source diff and one
   Undo entry.
4. Undo and Redo; compare source bytes and the exact frame before/after.
5. Refresh while the element is selected. Repeat for a registered animation.
6. Edit the source externally while the same object is selected; verify HMR preserves the stable
   selection or reports that the object no longer exists.

Pass condition: selection identity, Inspector scope, source target, and frame output agree across GUI,
refresh, HMR, Undo, and Redo.

### S06–S08: media, editorial, and motion

1. Open a media bin with dozens of entries. Search by name, asset ID, MIME type, filename, and hash;
   filter by video/audio/image/other; clear both filters.
2. Select an asset and verify preview, portable `asset://` identity, original/proxy state, hash, size,
   and disk action.
3. In Editorial Lab, front-trim a video at the playhead and confirm source seconds advance with the
   moved left edge. Move it vertically and verify the authored layer changes.
4. Scrub backward and jump randomly after every edit.
5. In Motion Lab, edit a key value/frame/ease, make an arc, record/cancel/commit a gesture, and unroll a
   safe helper. Each compound operation should be one history item.

Pass condition: random-access preview matches forward playback, and media/timing authority remains
portable and visible.

### S09–S12: finishing, generation, and artifacts

1. Toggle Grade bypass by button and momentary `B`; blur the window while holding `B` and confirm the
   bypass cannot remain stuck.
2. Capture graded and bypassed exact frames and compare them with preview.
3. Open an imported 3D shot; edit camera A/B, look-at, lens, focus, plane, and motion-blur values.
4. Review a pinned generative take. Confirm generation is an explicit action and existing take
   provenance is immutable. Provider calls should use a sandbox/test account during release testing.
5. Open Cache, search by composition/label/hash, distinguish source assets from bakes, refresh it, and
   verify stale artifacts are explained without duplicate diagnostic spam.

Pass condition: the user can state which exact inputs produced the visible frame and which artifacts
must be rebuilt.

### S13–S14: agent/LLM and mixed-author editing

1. Call `inspect()` and retain its revision. Verify stable composition/object/animation IDs, sources,
   assets, artifacts, and Git dirtiness.
2. Run `check()`. Errors must block “ready”; warnings must say “ready with warnings”; identical
   physical artifact findings should be grouped.
3. Capture an exact random frame and retain its hash.
4. Execute one semantic placement/property/key edit with the inspected revision. Verify one receipt,
   one source diff, refreshed project state, and an after-check.
5. Undo that edit from the GUI, redo it from the agent API, then restore the initial bytes.
6. Repeat with an intentionally stale revision after an external edit. No write may occur, and the
   response must identify a source conflict.

Pass condition: GUI, code author, and agent can alternate without last-writer-wins data loss.

### S15–S18: compact layout, project operations, delivery, and recovery

1. At 900×700, verify the document and top bar do not overflow horizontally; Render remains in the
   viewport; Properties/Code/Guide open in a dismissible side panel.
2. Open New Composition. Confirm focus enters the name field, Escape/click-outside/Cancel close it,
   focus returns to the trigger, and Enter creates only when the request is valid.
3. In an isolated fixture, create each supported kind, duplicate it, nest it, copy it to the library,
   and delete the copy with the two-step guard. Verify files and registry edits return to their exact
   initial bytes after cleanup.
4. Render short and full ranges with and without audio. Verify dimensions, fps, range origin, output
   filename/path, exact input fingerprint, and deterministic frame hashes.
5. Introduce invalid syntax, remove a selected stable ID, and race an external source change against a
   GUI/agent edit. The Studio must retain recoverable state and never overwrite the external edit.

Pass condition: constrained space and failure paths expose recovery actions instead of hiding tools or
silently changing source.

## Findings from the 2026-07-20 pass

| Finding | User impact | Resolution and regression |
| --- | --- | --- |
| Compact windows hid the entire right panel and expanded the header beyond the viewport | Properties/Code/Guide and Render became unreachable | Dismissible compact side panel, bounded grid/header CSS, 900×700 E2E |
| Refresh stored only a timeline item ID | An element selection reopened as a broad owner clip; animation identity was lost | Versioned stable-selection storage with legacy migration; unit + refresh E2E |
| Media and cache collections had no search/filter | Large production projects required scanning dozens of rows | Media text/type filter and cache text filter; helper unit tests + E2E |
| New Composition ignored Escape and did not restore focus | Keyboard users were trapped in a modal-like sheet | Modal keyboard handler, `aria-modal`, named close action, focus return; E2E |
| Agent check said `READY` while showing many warnings | Users could misread warning-heavy state as clean | Explicit `READY WITH WARNINGS/NOTES`, severity styling, E2E |
| Stale cache records produced repeated identical messages | Useful agent findings were pushed below the first ten rows | Per-composition stale-artifact grouping and diagnostic dedupe; unit test |

## Sustainable test architecture

### 1. Pure unit tests — every edit

Use Vitest for parsing, geometry, timeline math, source maps, fingerprints, view-model transitions,
filters, and validation. Tests should use stable IDs and literal expected values. A bug in a pure
decision function should get a focused test before or with the fix.

Command: `npm run test:unit`

### 2. Source-transaction integration tests — every edit kernel

Exercise real before/after source text, receipts, conflict hashes, Undo/Redo, HMR probes, and
agent-command dispatch without rendering the full UI. Every semantic writer must cover:

- successful exact rewrite;
- unsupported/computed authority refusal;
- stale expected revision or atomic-commit race;
- one grouped receipt and exact Undo/Redo bytes;
- backward/random-access state after refresh.

These tests remain part of the Vitest suite and should live next to the owning runtime/model module.

### 3. Browser workflow smoke tests — every GUI/contract change

Playwright boots the real Production Lab and covers cross-surface workflows: orientation, search,
Guide navigation, stable selection refresh, compact layout, modal keyboard behavior, agent check, and
exact snapshot. Browser smoke tests must not leave source edits behind; write-heavy GUI scenarios use a
temporary fixture or remain in the isolated integration layer until that fixture exists.

Commands:

```sh
npx playwright install chromium   # once per machine/CI image
npm run test:e2e
npm run test:e2e:headed           # useful for exploratory debugging
```

On failure, Playwright retains a trace plus failure screenshot/video. Keep assertions on user-visible
state and stable IDs; avoid pixel coordinates except in explicit direct-manipulation tests.

### 4. Exact-frame and render verification — release and render changes

For render/runtime changes, sample boundary, midpoint, effect-transition, and random frames twice;
compare content hashes and preview/capture/export state. Add a short AV render with timestamps and
audio, then a representative production range. Large licensed assets stay out of general CI; CI uses
small checked-in fixtures with the same codecs/contracts.

### 5. Exploratory release pass — milestone releases

Run this document’s charters with a clean browser profile, a dirty Git worktree, missing/stale cache
variants, 900×700 and normal desktop viewports, keyboard-only navigation, and one mixed GUI/agent edit
session. Record the build SHA, OS/browser, fixture revision, scenarios, evidence, and issue links.

## Gates and contributor workflow

| Change | Required gate |
| --- | --- |
| Pure model/runtime/view-model | `npm run test:unit` + affected workspace typecheck |
| Svelte/CSS/interaction | `npm run test:quick` + `npm run test:e2e` |
| Source writer/agent command | Unit + transaction/conflict/Undo integration + E2E workflow when visible |
| Capture/render/codec | All above + exact-frame and short AV render evidence |
| Release candidate | `npm run test:ci` + exploratory charters + full representative render |

When fixing a bug:

1. Preserve the smallest reproducible user scenario and evidence.
2. Add the lowest-layer regression that can catch the root cause reliably.
3. Add or extend an E2E only when the failure crosses UI/surface boundaries.
4. Verify source bytes, history, stable selection, and random-access output—not only the visible toast.
5. Update this charter when a new failure class or workflow becomes important.

The long-term gap is an isolated, tiny Studio fixture specifically for write-heavy browser tests. It
should copy into a temporary directory per worker and cover create/duplicate/nest/delete, Inspector
writes, timeline trim, Undo/Redo, external-write conflict, and render preflight without touching a
developer’s production example.
