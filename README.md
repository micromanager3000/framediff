# FrameDiff

FrameDiff is an open-source, code-first video toolkit. Author compositions as plain HTML, CSS, and
TypeScript; preview them in a visual Studio; and render them deterministically in the browser with
WebCodecs and WebGPU.

The project treats code as the source of truth. Direct manipulation, normal code editing, and AI
agents all operate on the same project files instead of translating through a proprietary timeline
format.

## Quick start

Requirements: Node.js 22+ and a Chromium-based browser.

```sh
npm install
npm run dev
```

The default command opens First Light, the smallest complete project. `npm run dev:playground`
opens the Studio Playground, which covers every capability at once. You can also run an
individual example:

```sh
npm run dev --workspace @framediff/example-first-light
npm run dev --workspace @framediff/example-studio-playground
npm run dev --workspace @framediff/example-hero-lower-third
npm run dev --workspace @framediff/example-hero-reel
npm run dev --workspace @framediff/example-lighttwist-social-creator
npm run dev --workspace @framediff/example-determinism-check
npm run dev --workspace @framediff/example-cloth-showcase
npm run dev --workspace @framediff/example-previz-to-gen
npm run dev --workspace @framediff/example-vertical-hero
```

If you have never used FrameDiff before, start with `example-first-light`. It is the
smallest project that still renders something worth watching, it needs no media
downloads, and its walkthrough is about the Studio itself rather than a brand's footage.

## Repository layout

- `packages/framediff` — composition runtime, effects, source bridge, and deterministic renderer.
- `packages/studio-model` — framework-neutral Studio application model and workspace contracts.
- `packages/studio-ui` — Svelte Studio interface.
- `examples` — runnable projects that consume the public packages.
- `tests/e2e` — browser coverage for the Studio and example workflows.
- `docs` — architecture, authoring contracts, and implementation guides.

Start with the [FrameDiff package guide](packages/framediff/README.md), the
[architecture guide](docs/ARCHITECTURE.md), and the [examples index](examples/README.md).

## Development

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Large example media is stored with Git LFS. Each example documents its assets and how to regenerate
derived files.

## License

FrameDiff source code is available under the [MIT License](LICENSE). Third-party code and assets keep
their respective licenses; see license files next to vendored components where present.
