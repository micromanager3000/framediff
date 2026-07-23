# FrameDiff

FrameDiff is a framework-free, code-backed video runtime. A composition is an ordinary HTML
document with CSS and JavaScript, plus a small `data-fd-*` contract that makes its timeline and
properties visible to the Studio. The same document is mounted for preview and deterministic
browser rendering with WebCodecs and WebGPU.

> This is the engine package. The hosted product that consumes it lives in the separate
> `micromanager3000/framediff-hosted` repository.

## Composition model

```html
<!doctype html>
<html>
<head><style>
  [data-fd-composition] { position: relative; overflow: hidden; background: #111; color: white; }
  .title { position: absolute; inset: 0; display: grid; place-items: center; }
</style></head>
<body>
  <main data-fd-composition data-fd-id="Title"
    data-fd-width="1920" data-fd-height="1080"
    data-fd-fps="30" data-fd-duration="90">
    <section class="title" data-fd-clip data-fd-id="title"
      data-fd-from="0" data-fd-duration="90">
      <h1 data-fd-id="title-text" data-fd-text="Hello">Hello</h1>
    </section>
    <script>
      onFrame(({ frame }) => {
        query(".title").style.opacity = Math.min(1, frame / 12);
      });
    </script>
  </main>
</body>
</html>
```

```ts
import { defineComposition } from "framediff";
import source from "./Title.html?raw";

export const titleComp = defineComposition(source);
```

The HTML is the visual source of truth. An optional setup module can import reusable logic,
third-party libraries, WebGPU/WebGL renderers, or data:

```ts
export const sceneComp = defineComposition(source, {
  setup({ query, onFrame, onCleanup }) {
    const canvas = query<HTMLCanvasElement>("canvas")!;
    const renderer = createMyWebGpuRenderer(canvas);
    const stop = onFrame(({ frame, time }) => renderer.draw({ frame, time }));
    onCleanup(() => { stop(); renderer.destroy(); });
  },
});
```

Use `registerCanvasCapture(canvas, capture)` when a WebGPU or WebGL canvas needs an exact
readback during export. Built-in adapters do this for graded video, 3D video planes, and three.js.

`FRAMEDIFF_CACHE_DIR` provides the same override for local scripts. The browser continues to use
`/__framediff-cache/<hash>` URLs, so `framediff.assets.json` remains portable. The folder itself uses
readable `<name>--sha256-<hash>.<ext>` filenames.

### Project asset storage

Projects can select asset storage with a small `framediff.config.json` at the project root. Keep
media in a machine-local folder with:

```json
{
  "assets": { "mode": "local", "path": "/Volumes/my-project-media" }
}
```

Relative paths are resolved from the project root, and `~` is supported. A launcher or project
setup screen can ask the user for a folder and write that value as `assets.path`.

To version the media with the project instead, use:

```json
{
  "assets": { "mode": "git-lfs" }
}
```

FrameDiff then creates a top-level `assets/` folder, initializes Git LFS for the repository, and
adds `assets/** filter=lfs diff=lfs merge=lfs -text` to `.gitattributes`. Imports, generated takes,
and baked assets are written there under readable content-addressed names. The Studio's normal Git
commit action stages the config, manifest, attributes, and asset files; Git stores the asset files
as LFS pointers. Git LFS must be installed before opening a project in this mode.

Every submitted generation attempt is also appended to the repo-tracked
`framediff.generations.json` ledger. It records the numbered take, recipe, resolved input hashes,
provider request ID, timestamps, final status, result asset ID, and any failure reason; failed
attempts therefore remain useful project history even though they have no media asset.

`framediffDev({ cacheDir })` and `FRAMEDIFF_CACHE_DIR` remain local overrides and take precedence
over the project config. Projects without the JSON config continue to use `framediff-cache/`.

## Runtime APIs

| API | Purpose |
| --- | --- |
| `defineComposition(html, options?)` | Parse dimensions, timing, metadata, and setup from authored HTML. |
| `mountComposition(host, comp, options?)` | Mount a composition and return `update`, `ready`, and `destroy`. |
| `createPlayer(host, comp, options?)` | Standalone play/pause/seek preview. |
| `onFrame(({ frame, time, playing }))` | Authored script/setup lifecycle, local to the composition. |
| `data-fd-clip`, `data-fd-from`, `data-fd-duration` | Timeline placement and local-frame window. |
| `data-fd-comp` | Nested composition reference from the registry. |
| `<video>`, `<audio>`, `data-fd-src` | Timed media with exact source-frame capture. |
| `createGradeVideoSetup()` | WebGPU video grade on `canvas[data-fd-grade-video]`. |
| `createVideoPlane3DSetup()` | WebGPU 3D video plane and camera tracks. |
| `defineVideoPlane3DComposition()` | A nestable 3D-plane shot with its own source/camera clock. |
| `escapeHtml()`, `htmlAttributes()`, `kebabCase()` | Safe helpers for generated composition markup. |
| `createThreeSceneSetup()` from `framediff/three` | Bind a pure three.js scene to `canvas[data-fd-three]`. |
| `defineThreeSceneComposition()` from `framediff/three` | A nestable three.js scene with named camera cuts. |
| `combineCompositionSetups()` | Compose reusable effect/integration setup modules and cleanup. |
| `checkCompositionDeterminism()` | Re-render selected frames and compare pre-encode pixel hashes. |
| `exportVideo(comp, options)` | Deterministically rasterize, mix audio, encode, and mux MP4. |

The complete authored attribute and Inspector contract is documented in
[`docs/HTML-COMPOSITIONS.md`](../../docs/HTML-COMPOSITIONS.md).

## Effect and project ownership

Reusable effect mechanics belong in this package. Project repositories should keep only presets,
content, fitted/imported source data, and composition instances:

```text
src/
├── compositions/   edits, nested shots, HTML documents, project composition instances
├── effects/        project look/camera/motion presets configuring packaged effects
├── data/           EDLs, copy, constants, imported camera rows, asset mappings
├── gen/            explicit generative recipes
└── config.ts       registry/orchestration only
```

Examples must not become a parallel effect library. A renderer, adapter, composition factory,
camera evaluator, deterministic helper, or DOM effect that is independent of one example's brand
and assets should move into `packages/framediff`, gain focused tests and a public export, and be
imported back into the example. See the canonical
[architecture and promotion rule](../../docs/ARCHITECTURE.md#the-example-to-package-promotion-rule).

The package currently includes typed named-look application, grade-attribute serialization,
data-driven clip motion, wipe and character-rise setups, audio fades, fitted camera-curve expansion,
and 3D-plane/three.js composition factories. Example `effects/` modules should therefore be small
configuration layers over these APIs, not independent implementations.

## Studio agent surface

Every Studio host exposes `window.__framediffAgent` with versioned `inspect`, `check`, `snapshot` and
`execute` calls. Agents receive stable object IDs, source authority, frame-native bindings, asset and
artifact hashes, guarded source revisions and exact edit receipts; their commands use the same
transaction/history path as the canvas, Inspector and timeline. See
[`docs/AGENT-API.md`](../../docs/AGENT-API.md).

## Rendering and determinism

FrameDiff rasterizes the authored DOM at output resolution. Source video frames are decoded at an
exact time with WebCodecs/MediaBunny, media audio is mixed offline, and encoding/muxing runs through
the existing browser export path. Hardware encoders may produce different compressed bytes across
machines; frame selection and authored state remain exact. Prefer software encoding when identical
codec output on the same machine matters.

The development bridge stores imported media, baked compositions, and generated takes in
`framediff-cache/`. `asset://` references resolve through `framediff.assets.json`, so authored HTML
does not contain machine-specific paths. Generation attempt history, including failures, is stored
separately in the tracked `framediff.generations.json` ledger.

## Requirements and current limits

- Chromium is recommended for WebCodecs and WebGPU.
- Composition scripts are trusted project code and execute with the same authority as imported
  local modules.
- DOM rasterization remains the main export throughput cost, especially at 4K.
- Generated compositions expose their recipe/data controls, while their generated HTML placement
  is intentionally read-only until materialized as a physical `.html` file.
