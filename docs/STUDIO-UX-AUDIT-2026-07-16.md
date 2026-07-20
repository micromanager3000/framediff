# FrameDiff Studio UX audit — 2026-07-16

This audit evaluates whether a new user can discover and complete FrameDiff's capabilities from the
Studio, not merely whether the source/runtime API exists. The Production Lab was exercised as a new
user would: from project orientation through selection, editing, editorial, motion, finishing,
generation, provenance, exact capture and local delivery.

## Outcome of this pass

The largest immediate problem was not missing engine capability; it was losing the thread between
the overview and many isolated labs. This pass added a source-declared, first-party walkthrough rather
than hard-coding tutorial behavior into the Studio:

- **One holistic project.** `ProductionLab` nests every major legacy and M0–M9 feature on one exact
  timeline, with a real audio lane and an `onFrame` chapter HUD.
- **Project Guide.** Seventeen persistent workflows have a plain-language action, observable success
  condition, exact target composition/frame/object and requested panel.
- **Persistent guided task.** Starting a step keeps the instruction above the preview even when the
  user switches to Properties, Code, Media, Cache or the agent check.
- **Composition discovery.** Search now matches composition name, key, kind and source file; a START
  badge identifies the project entry point.
- **Selection continuity.** Clicking canvas or timeline content opens Properties automatically instead
  of leaving a tutorial or code panel stranded beside a new selection.
- **Nested navigation.** A selected nested clip exposes a clear **Open nested composition** action and
  preserves breadcrumb/up navigation.
- **Production provenance.** Properties now labels original/proxy availability, stable asset identity,
  content/proxy hashes, take pin, effects, nested composition and bake state in readable terms.
- **Finishing comparison.** A visible **Grade on / Grade bypassed** control documents the B shortcut and
  makes local LUT/grade comparison discoverable.
- **First-selection onboarding.** Empty Properties explains how canvas, timeline, motion and media
  selections map to editable source.
- **3D shot direction.** Imported camera rows now open as a purpose-built rig instead of 34 raw
  camelCase fields: top-view path, lens/FOV guide, A/B endpoints, pose/target, focus/DOF, shot-key
  timing, plane transform, maximum blur, shutter angle and motion samples are editable source.

These improvements keep FrameDiff's governing model intact: the project and guide are source; stable
IDs connect every surface; edits are guarded source transactions; preview/export remain exact and local.

## Current experience by workflow

| Workflow | UI status after this pass | Remaining friction |
| --- | --- | --- |
| Find the starting point | Strong — default Production Lab, START badge, search, Guide | Large projects still need folders/tags/favorites |
| Select and transform | Strong for one element — canvas handles, constraints, typed Properties, materialize | No multi-select, group transform, alignment/distribution or safe-area overlays |
| Text and visual properties | Strong for the supported typed ABI | No design-token/style browser, eyedropper, gradient-on-canvas handles or reusable presets |
| Media identity/proxies | Understandable — Media plus provenance in Properties | Import/choose/apply is still split; no source monitor, waveform or proxy-generation task state |
| Timeline edit/stack/trim | Functional and source-backed | Track headers need mute/solo/lock; no marquee/ripple/slip/roll tools or waveform thumbnails |
| Undo/Redo | Strong — grouped source receipts and conflict guards | History needs a visible transaction list and before/after source diff preview |
| GSAP/keys/paths | Functional and exact, with curves/auto-key/gesture/unroll | Curve editing needs direct Bezier handles, multi-key selection, dope-sheet filters and value readouts |
| Grade/LUT | Exact and local, bypass now obvious | Effects need a browsable ordered stack, LUT picker/preview, scopes and comparison layouts |
| Imported 3D | Strong for camera-driven video-plane shots — dedicated rig, path, lens/FOV guide, endpoints, focus/DOF, plane and finishing | No full scene outliner, orbit/pan viewport, transform gizmos, lights/materials or focus-plane overlay |
| Generative takes | Safe — explicit Generate, draft/stale model, pinned provenance | Generated takes need drag/apply-to-selection, contact sheets, cost estimate and clearer failure/retry UX |
| Source/unroll | Strong safety model and canonical rewrite | Code needs target range highlighting, a visual pre/post diff and recovery guidance on conflicts |
| Cache/artifacts | Inspectable with fingerprints and stale/current state | Dependency graph and “what changed?” explanation should be visual; rebuild actions need queue feedback |
| Agent/exact/render | Shared API and exact local path | Render needs presets, range/codec/audio validation, queue/history and a preflight checklist |

## Priority plan

### P0 — make a real edit session self-explanatory

1. **Integrated media source monitor and trimmer.** Selecting an asset should show duration, waveform,
   source in/out, proxy status and one **Insert/Overwrite/Replace selection** action. This closes the
   largest gap between portable media identity and editorial use.
2. **Track controls and timeline feedback.** Add mute, solo, lock and visibility to persistent track
   headers; add waveforms/thumbnails and explicit snapping guides. Users must be able to reason about
   the output without reading source.
3. **Render preflight and presets.** Present range, dimensions, fps, codec, audio, missing assets,
   stale bakes and unsupported constructs before render. Save presets and show queue/history with the
   local output path and exact input fingerprint.
4. **Source transaction history.** Expose the existing grouped receipts as a history drawer with label,
   affected files and small before/after diff. Undo/Redo becomes trustworthy when users can see its
   scope before invoking it.
5. **Effect/LUT stack.** Selected clips/layers need an ordered, enable/bypass/reorderable effect stack,
   a LUT browser with thumbnails, intensity, scopes and split/wipe comparison.

### P1 — make design and motion competitive without weakening source authority

1. **Multi-select and group transforms.** Shift-select in canvas/timeline, bounding-box transform,
   align/distribute, guides, safe areas and one grouped source transaction.
2. **Real graph/dope-sheet editor.** Multi-key selection, box select, direct Bezier handles, numeric
   values, copy/paste, frame snapping and lane filters. Keep GSAP as an adapter to absolute frames.
3. **Asset application workflow.** Search/filter media, preview renditions, and apply an `asset://` ref
   to the selected image/video/fill from the same panel. Surface proxy generation progress and errors.
4. **Source target and rewrite review.** When Properties or Unroll changes source, Code should reveal
   and highlight the exact span, show the proposed diff, and make revision conflicts actionable.
5. **Automatic Guide success checks.** Extend guide metadata with optional machine-readable assertions
   (selection, property, frame/hash, history receipt, artifact state). Keep manual completion available
   for exploratory steps.
6. **Generative take integration.** Contact sheet, compare, pin, cost estimate, provider progress,
   retry, and **Apply take** to a selected media/fill target as a normal grouped source edit.

### P2 — scale, depth and collaboration

1. Composition folders/tags/favorites, recent items and dependency/usage graph.
2. 3D camera viewport, transform gizmos, focus plane, depth and motion-blur overlays.
3. Branch/review UI around source transactions, exact frame annotations and artifact fingerprints.
4. Customizable shortcuts, command palette, searchable keyboard reference and accessibility pass for
   focus order, screen-reader names, color contrast and non-pointer timeline editing.
5. Performance instrumentation and progressive preview quality for large nested projects without
   changing exact capture/export behavior.

## Product rule for future UI work

Every user-facing feature should pass the same vertical acceptance test:

1. A new user can discover it from their current selection or task.
2. The UI explains the action and the observable success state.
3. The edit addresses stable project IDs and produces one guarded, readable source transaction.
4. Undo/Redo restores the entire intent as one unit.
5. HMR, backward/forward random-access scrubbing and exact capture agree.
6. Asset identity and artifact provenance remain portable and content-addressed.
7. Local render uses the same declared inputs; no hidden cloud or wall-clock state is introduced.
8. Code and agents can inspect and perform the same semantic operation.

That rule is the practical meaning of “seamless/end to end” for FrameDiff: not one enormous UI, but
one continuous source-backed object model from intent through delivery.

## Deep editability conclusion

No: it would be misleading to claim that literally everything is editable in the UI. After this pass,
the high-value parameters that already have a stable, serializable source contract are reachable and
truthful in the UI. Arbitrary program logic and some higher-order editing workflows are deliberately
not projected as fake controls.

| Surface | UI authority now | Boundary that remains |
| --- | --- | --- |
| Canvas geometry | Select, move, resize, constraints, typed position/size/opacity/scale/rotation, materialize computed geometry | Multi-select, align/distribute, safe areas and group transforms |
| Text and layout | Text, typography, color/fill, gradients, image fills, flex, padding, opacity, blend/isolation | Design tokens, reusable styles, visual gradient handles and complex rich-text runs |
| Media/editorial | Asset identity and proxy/original provenance; clip timing, front trim, playback, volume/mute, fit, lane movement and stacking | Source monitor, waveform/thumbnails, track mute/solo/lock, ripple/slip/roll and multi-clip operations |
| Motion | Registered GSAP timing, values, keyframes, easing, auto-key, arc path, tangents, gesture recording and safe unroll | Direct Bezier graph handles, multi-key editing, dope-sheet filters and opaque third-party callbacks |
| Grade/LUT | Authored HTML grade/LUT controls, presets, bypass and exact browser-local capture/export | A unified ordered effect stack, LUT browser, scopes, and generated-shot per-look authority |
| 3D video-plane shot | Start/end camera and look-at, lens/FOV, focus point/distance, DOF, shot-key timing, plane size/pose/rotation/scale, max blur and motion blur | Fitted progress/aperture curves, interpolation choice, arbitrary scene objects, lights/materials and viewport gizmos |
| Generative media | Prompt/model/params/references, explicit spending action, immutable takes, pinning and provenance | Cost estimate, contact sheet, retry queue and one-step apply/replace selected media |
| Undo/source | Atomic grouped receipts, conflict guards, Undo/Redo, source view and trace-verified unroll | Visible transaction history, proposed diff review and source-span highlighting |
| Delivery | Deterministic preview, random-access exact snapshots, cache fingerprints and local MP4 render | Render presets, preflight, queue/history and range/codec/audio configuration UI |

### What should stay code-first

An `onFrame` callback can contain arbitrary branching, loops, async setup or custom rendering code.
Inventing a generic control for that code would either be lossy or lie about what will render. The
right rule is: keep opaque logic code-first until the author declares a small parameter ABI, or use
**Unroll to edit** when a deterministic runtime trace can be converted safely into explicit frame data.

The same rule currently applies to the imported camera's fitted progress/aperture curves and camera
interpolation. The endpoints and finishing values are honest numeric parameters; the fitted curve is
authored behavior. A future graph editor should expose that curve as explicit keys, not as a mystery
“smoothness” slider that silently changes the shot.
