# Composition property audit

This audit maps the active composition capabilities that previously lived behind component props to
the framework-free HTML/runtime contract. “Editable” means the current Svelte Studio can discover the
value, present the correct input type, and persist a targeted source edit.

| Existing capability | Plain composition representation | Preview/export | Editable |
| --- | --- | --- | --- |
| Composition id, size, fps, duration | Root `data-fd-id/width/height/fps/duration` | Yes | Declared source metadata; not a clip Inspector field |
| Kind, library, alpha, image output | Root `data-fd-kind/library/alpha/output/output-frame` | Yes | Metadata/source operations |
| Render window | Root `data-fd-render-from/to` | Yes | Render-range Studio operation |
| Sequence placement | `data-fd-clip`, stable id, `data-fd-from/duration` | Yes, including negative starts | Yes |
| Local frame/time | Runtime CSS variables, datasets, and `onFrame` state | Yes | Derived/read-only |
| Absolute-fill/layer layout | Ordinary CSS | Yes | Opt-in attrs below |
| Position/scale/rotation | `data-fd-x/y/scale/rotation` | Yes | Number inputs |
| Size/opacity/z-index/radius | `data-fd-width/height/opacity/z-index/border-radius` | Yes | Number inputs |
| Text and typography | Stable descendant id plus `data-fd-text/color/font-size/line-height/letter-spacing` | Yes | Targeted text/number inputs |
| Background | `data-fd-background` | Yes | Text input |
| Video source/timing | `<video data-fd-src trim-start playback-rate muted fit>` or clip overrides | Exact frame decode on export | Text/number/boolean inputs |
| Audio source/timing/gain | `<audio data-fd-src trim-start playback-rate volume>` or clip overrides | Offline mix and mux | Text/number inputs |
| Nested composition | `data-fd-type="nested"`, `data-fd-comp`, trim, rate, nested scale | Yes, recursively | Text/number inputs |
| Floating grade layer | `data-fd-grade-layer` plus grade attrs | DOM backdrop grade | Grade Inspector and presets |
| WebGPU graded video | `canvas[data-fd-grade-video]` + `createGradeVideoSetup()` | Exact capture seam | Source, timing, grade, LUT, render size |
| WebGPU 3D video plane | `canvas[data-fd-video-plane-3d]` + setup options | Exact capture seam | Media/grade/max-blur attrs; camera data arrays |
| Camera endpoints and keyframes | `cameraFrom/to` or `cameraKeyframes` in setup module | Ease, linear, monotone/spline alias | Code-backed camera data where declared |
| Three.js scene | `canvas[data-fd-three]` + `createThreeSceneSetup()` | Deterministic update/capture | Timed named camera cuts; scene code stays code |
| Arbitrary WebGPU/WebGL | Authored canvas + setup module + `registerCanvasCapture` | Yes | `data-fd-prop-*` controls are opt-in |
| Pure frame animation | Inline `onFrame` or imported setup | Same lifecycle in preview/export | Source code; exposed attrs can be Inspector inputs |
| Reusable/data-driven application logic | Imported JavaScript/TypeScript modules and ordinary data | Yes | `editableData` supports numeric object arrays, numeric objects, and camera rows |
| Generative composition | Framework-free generated HTML player/slate plus recipe module | Yes | Recipe/take controls; generated placements read-only |
| Content-addressed precomp/bake | Existing graph, fingerprint, CAS, and resolver APIs | Yes | Bake/render operations |

## Intentional boundaries

- HTML/CSS own the visual tree; a framework is no longer needed to express reuse. Authors can use
  template functions, modules, custom elements, or any library inside setup code without making that
  library part of FrameDiff's composition ABI.
- The Studio only exposes properties present in source. This avoids a generic style panel inventing
  values that are not part of the authored design.
- Descendant content/style controls require their own stable id. Media and effect controls may be
  inherited to the selected clip, because those clip-level overrides are part of the runtime contract.
- GPU pixels cannot be recovered reliably from DOM serialization alone. Custom GPU renderers must
  register a deterministic capture callback; the built-in adapters already do so.

## Migrated composition review

| Composition set | Inspector/timeline exposure reviewed |
| --- | --- |
| Frontend `MyVideo` | Title/greeting text, layer transforms, video timing/source/mute, named music-bed timing/gain, and WebGPU T-Rex wave speed |
| Frontend `Main` / `SceneCams` | Nested-comp timing/trim, camera cuts, camera-layer opacity, and library metadata |
| Determinism check | No artist controls by design; its only authored variable is absolute frame time |
| Hero lower-third physical comps | Lower-third/end-card copy and opacity, grade controls, media source/timing, audio gain, and nested placement timing |
| Hero lower-third generated rebuild | EDL/pane/text-transform numeric rows and virtual-camera rows via `editableData`; generated placements and string copy remain code-backed/read-only |
| Hero reel | Caption/lower-third/end-card copy, grade/LUT controls, named music/sting controls, and 3D max blur |
| Previz-to-generation | Scene/camera and nested/generated-shot placement timing, nested scale, named music controls, and render window; three.js scene construction remains code |

## Remaining non-migration limitation

The precomp baker's `MediaBundle.audioStems` output remains empty, as it was before this migration;
nested runtime audio and final-export audio mixing are supported. Preserving separately addressable
audio stems inside baked precomp artifacts is a distinct build-graph feature, not a React/HTML
composition gap.
