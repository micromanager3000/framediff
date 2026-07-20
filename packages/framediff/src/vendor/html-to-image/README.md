# Vendored: html-to-image

TypeScript source of [html-to-image](https://github.com/bubkoo/html-to-image) v1.11.13
(MIT, see [LICENSE](./LICENSE)), copied verbatim from the published npm package's `src/`.

## Why vendored

The exporter rasterizes every frame through `toCanvas`, which resolves through
`requestAnimationFrame` in `createImage` (`util.ts`). rAF never fires in a hidden window,
so a minimized browser froze exports at the first frame. Vendoring lets us patch that
line and own the DOM-capture path (see the capture stand-in machinery in `src/render/`).

## Local modifications

Patched hunks are marked `FRAMEDIFF PATCH` in the source:

- `util.ts` `createImage`: resolve directly after `img.decode()` when the document is
  hidden (and bail out on `visibilitychange` if it hides while a settling rAF is
  pending) instead of unconditionally awaiting `requestAnimationFrame`.
- `dataurl.ts`: one cast so the catch variable typechecks under this repo's strict
  tsconfig (upstream compiles with a laxer config).

When diffing against upstream, compare with the `src/` directory of the
`html-to-image@1.11.13` npm package.
