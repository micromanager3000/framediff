# SvelteKit Studio architecture

> This is the implemented editor-shell specialization of the canonical
> [FrameDiff architecture](./ARCHITECTURE.md). It does not redefine composition/effect ownership.

> **Date:** 2026-07-12
> **Status:** editor and composition-runtime cutover complete; all workspace examples use SvelteKit
> **Reference:** `/path/to/reference-studio`

FrameDiff now separates the editor UI from the video composition runtime:

- Video compositions and overlays are authored as plain HTML/CSS/JavaScript documents.
- Editor chrome and interaction surfaces are Svelte components hosted by SvelteKit.
- ViewModels are TypeScript modules that may use Svelte stores.
- Models and model managers are framework-independent TypeScript.
- A framework-independent runtime port is the only boundary through which the editor mounts,
  introspects, edits, and exports compositions or accesses the local Vite project bridge.

## Dependency direction

```text
SvelteKit route
  -> Svelte views (.svelte)
    -> ViewModels (.ViewModel.ts, svelte/store allowed)
      -> StudioApplication and managers (plain TypeScript)
        -> StudioRuntimePort
          -> HtmlStudioRuntime (HTML preview/introspection/export + Vite project bridge)
```

Views may perform DOM-only work such as focus, pointer geometry, and file-input activation. They do
not read project state or issue backend/source operations directly. ViewModels expose view-ready
stores and commands. Managers own project facts, async state, and lifecycle.

The application is scoped per SvelteKit route; managers are not global singletons. This permits
deterministic teardown and leaves room for multiple Studio windows or projects.

## Packages

- `packages/studio-model`: framework-independent session, models, ports, and managers.
- `packages/studio-ui`: Svelte views and ViewModels.
- `packages/framediff/src/studio-runtime`: framework-free HTML composition runtime adapter.
- `examples/hero-lower-third`, `examples/hero-reel`, and
  `examples/previz-to-gen`: SvelteKit Studio hosts with plain HTML composition projects.
- `examples/determinism-check`: a custom SvelteKit results view that invokes the HTML renderer.

The Studio route has SSR disabled because composition rendering depends on browser APIs including
WebCodecs, WebGPU, media elements, and browser DOM APIs. SvelteKit still supplies the application
shell, routing conventions, build lifecycle, and future server integration points.

## Implemented editor surface

- SvelteKit application host and static adapter
- HTML registry replacement through explicit Vite HMR
- Framework-free composition preview mounted once inside a Svelte host
- HTML source introspection into plain timeline and Inspector snapshots
- Svelte composition rail, transport, timeline, and inspector
- Source-backed timeline drag/move/trim edits, committed atomically with HMR state preservation
- Nested-composition navigation with breadcrumbs and an indented composition tree
- Schema-driven placement, grade-preset, editable-data, and advanced camera inspectors
- Svelte media and source-code panels
- Framework-free asset, source, Git, playback, and render managers
- Git status/checkpoint and MP4 render controls
- Generative recipe editing, provider configuration, submission, take inspection, and pinning
- Cache inspection/debugging and composition baking
- New, copy, and library composition operations

## Compatibility and cutover

The legacy React `Studio`/`StudioApp` and React composition component API are no longer part of
FrameDiff's public API. Svelte remains an editor-shell implementation detail: compositions do not
load a Svelte or React runtime. The `data-fd-*` HTML contract supplies stable timeline identity and
editable property metadata, while setup modules provide reusable TypeScript, WebGPU, WebGL, and
three.js behavior. Svelte views own editor presentation, Svelte-aware ViewModels prepare view data,
and framework-free TypeScript managers and `HtmlStudioRuntime` own state and operations.
